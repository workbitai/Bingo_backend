const { Server } = require("socket.io");
const Room = require("../Models/Room");
const User = require("../Models/Users");
const GameWallet = require("../Models/GameWallet");
const RandomUser = require("../Models/RandomUser");
// const QRCode = require('qrcode');
const jwt = require("jsonwebtoken");

const { createActualBingoRoom, addBotAndStartGame, generateBingoTicket } = require("../Controllers/Room");
require("dotenv").config();

const BASE_URL = process.env.BASE_URL;

const waitingRooms = new Map();

module.exports = (server) => {
    const io = new Server(server, {
        cors: { origin: "*" }
        // 60 sec tak wait
    });


    io.use((socket, next) => {
        //   console.log("--- New Handshake Attempt ---");

        //   // 1. Check karein token mil raha hai ya nahi
        const token = socket.handshake.auth.token || socket.handshake.headers.token;
        //   console.log("Token status:", token ? "Token Received" : "Token is MISSING");

        if (!token) {
            console.error("DEBUG: Middleware stopped because token is missing.");
            return next(new Error("Token missing"));
        }

        try {
            // 2. Check karein secret key sahi hai
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log("DEBUG: Token verified successfully. User ID:", decoded.user_id);

            socket.verified_id = decoded.user_id;
            next(); // Agar ye call nahi hua, toh io.on("connection") kabhi nahi chalega
        } catch (err) {
            // 3. Catch error details (jaise expired token ya galat secret)
            console.error("DEBUG: JWT Verification Failed:", err.message);
            next(new Error("Invalid Token"));
        }
    });
    const disconnectionTimers = {}; // 1-min win timer store karne ke liye
    const turnTimeouts = {};

    const checkBingoLines = (ticket, calledNumbers) => {
        let lines = 0;
        ticket.forEach(row => { if (row.every(num => calledNumbers.includes(num))) lines++; });
        for (let i = 0; i < 5; i++) {
            const col = [ticket[0][i], ticket[1][i], ticket[2][i], ticket[3][i], ticket[4][i]];
            if (col.every(num => calledNumbers.includes(num))) lines++;
        }
        const d1 = [ticket[0][0], ticket[1][1], ticket[2][2], ticket[3][3], ticket[4][4]];
        const d2 = [ticket[0][4], ticket[1][3], ticket[2][2], ticket[3][1], ticket[4][0]];
        if (d1.every(num => calledNumbers.includes(num))) lines++;
        if (d2.every(num => calledNumbers.includes(num))) lines++;
        return lines;
    };
    // 1. Bot ki ticket random numbers (1-25) se generate karne ke liye
    const generateBotTicket = () => {
        let nums = Array.from({ length: 25 }, (_, i) => i + 1).sort(() => Math.random() - 0.5);
        let ticket = [];
        for (let i = 0; i < 5; i++) {
            ticket.push(nums.slice(i * 5, (i + 1) * 5));
        }
        return [ticket]; // Array of tickets
    };

    // 2. Bot ka Decision Logic (Easy, Medium, Hard)
    const getBotDecision = (botPlayer, room) => {
        const difficulty = ['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)];
        let availableNumbers = [];

        // Sirf wo numbers jo bot ki ticket mein hain aur abhi tak call nahi hue
        botPlayer.tickets[0].flat().forEach(num => {
            if (!room.calledNumbers.includes(num)) availableNumbers.push(num);
        });

        if (difficulty === 'hard') {
            // Hard: Wo number choose karega jo kisi row/col ko complete karne ke pass ho
            // Simple implementation: random available number
            return availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
        }
        return availableNumbers[Math.floor(Math.random() * availableNumbers.length)];
    };

    // 3. Bot Turn Handler (Delay ke saath taaki real lage)




    io.on("connection", (socket) => {
        console.log("socket connected", socket.id);
        socket.on("disconnect", async () => {
            try {
                console.log("User disconnected:", socket.id);
                const room = await Room.findOne({ "players.socketId": socket.id, status: 'playing' });
                if (!room) return;

                const player = room.players.find(p => p.socketId === socket.id);
                if (!player) return;

                const user_id = player.user_id;
                const roomId = room.roomId;

                // console.log(`User ${user_id} disconnected. Starting 1-min win timer...`);
                io.to(roomId).emit("playerOffline", { user_id, message: "Opponent disconnected. Winning in 60s if not rejoined." });

                // 1 Minute (60000ms) Timer Start
                disconnectionTimers[user_id] = setTimeout(async () => {
                    const currentRoom = await Room.findOne({ roomId, status: 'playing' });
                    if (!currentRoom) return;

                    const winner = currentRoom.players.find(p => p.user_id !== user_id);

                    currentRoom.status = 'finished';
                    currentRoom.winner = winner ? winner.username : "System";
                    await currentRoom.save();
                    await Room.deleteOne({ roomId: currentRoom.roomId });
                    io.to(roomId).emit("gameOver", {
                        winner: currentRoom.winner,
                        user_id: winner ? winner.user_id : null,
                        reason: "Opponent failed to rejoin within 1 minute."
                    });

                    const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });
                    if (!wallet) return;

                    // 🔹 winner coins ADD (not replace)
                    await User.findOneAndUpdate(
                        { user_id: winner.user_id },
                        {
                            $inc: {
                                coins: wallet.coinsWon, // ex: 400
                                diamonds: wallet.diamondsWon
                            }
                        },
                        { new: true }
                    );


                    // await Room.deleteOne({ roomId: roomId });
                    delete disconnectionTimers[user_id];
                }, 60000);

            } catch (err) { console.error("Disconnect Error:", err); }
        });

        socket.on("createPrivateRoom", async ({ user_id, cardCount, gamelobby_id }) => {


            try {

                if (user_id != socket.verified_id) {
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                const user = await User.findOne({ user_id }).lean();
                if (!user) return;

                const joinKey = Math.random().toString(36).substring(2, 8).toUpperCase();
                const roomId = "PVT_" + Date.now();
                // const qrCodeData = await QRCode.toDataURL(joinKey);

                // console.log("qrCodeData", qrCodeData)

                // 🔗 JOIN URL (IMPORTANT)
                const joinUrl = `${BASE_URL}join/${joinKey}`;

                const newRoom = new Room({
                    roomId: roomId,
                    joinKey: joinKey,
                    joinUrl: joinUrl,
                    gamelobby_id: gamelobby_id,
                    isPrivate: true,
                    adminId: user_id,
                    cardCount: Number(cardCount) || 1,
                    maxPlayers: 10,
                    players: [{
                        user_id: user.user_id,
                        name: user.username,
                        socketId: socket.id,
                        avatar: user.avatar,
                        isReady: false,
                        hasUsedPower: user.power > 0 ? false : true
                    }]
                });

                await newRoom.save();
                socket.join(roomId);
                socket.emit("createPrivateRoom", { joinKey, joinUrl, roomId, players: newRoom.players, adminId: user_id });
            } catch (err) { console.error(err); }
        });

        socket.on("joinPrivateRoom", async ({ user_id, joinKey }) => {
            try {

                if (user_id != socket.verified_id) {
                    return socket.emit("error", { message: "Unauthorized!" });
                }
                // console.log('currentPlayer')
                let room = await Room.findOne({ joinKey });
                if (!room) return socket.emit("error", { message: "Room not found!" });
                const player = room.players.find(p => p.user_id === user_id);
                // if (room.status !== 'waiting') return socket.emit("error", { message: "Room not found or game started!" });

                if (player) {
                    // REJOIN LOGIC: Agar player pehle se hai, toh socket update karo
                    player.socketId = socket.id;

                    // 1-min timer cancel karein
                    if (disconnectionTimers[user_id]) {
                        clearTimeout(disconnectionTimers[user_id]);
                        delete disconnectionTimers[user_id];
                    }

                    await room.save();
                    socket.join(room.roomId);

                    // Agar game chal raha hai toh state bhejein
                    if (room.status == 'waiting' || room.status == 'setup' || room.status == 'playing') {
                        return socket.emit("rejoinSuccess", {
                            roomId: room.roomId,
                            joinKey: room.joinKey,
                            joinUrl: room.joinUrl,
                            status: room.status,
                            turn: room.turn,
                            calledNumbers: room.calledNumbers,
                            players: room.players,
                            cardCount: room.cardCount,
                            adminId: room.adminId
                        });
                    } else if (room.status == 'finished') {
                        const winnerData = room.players.find(p => p.name === room.winner);
                        await Room.deleteOne({ roomId: room.roomId });
                        return socket.emit("gameOver", {
                            winner: room.winner,
                            user_id: winnerData ? winnerData.user_id : null,
                            reason: "Opponent failed to rejoin within 1 minute or game ended."
                        });

                    }
                } else {
                    // const room = await Room.findOne({ joinKey, status: 'waiting' });

                    if (!room) return socket.emit("error", { message: "Room not found or game started!" });
                    if (room.players.length >= 10) return socket.emit("error", { message: "Room is full!" });

                    const user = await User.findOne({ user_id }).lean();
                    console.log("user", user);
                    if (room.players.find(p => p.user_id.toString() === user_id.toString())) return;
                    console.log("user data", user);
                    room.players.push({
                        user_id: user.user_id,
                        name: user.username,
                        socketId: socket.id,
                        avatar: user.avatar,
                        isReady: false,
                        hasUsedPower: user.power > 0 ? false : true
                    });
                    // console.log("room", room.players.length);
                    await room.save();
                    socket.join(room.roomId);
                    io.to(room.roomId).emit("joinPrivateRoom", { joinKey: room.joinKey, joinUrl: room.joinUrl, roomId: room.roomId, players: room.players, totalPlayer: room.players.lenth, adminId: room.adminId });
                }
            } catch (err) { console.error(err); }
        });

        // --- NEW: START PRIVATE GAME (ADMIN ONLY) ---
        socket.on("startPrivateGame", async ({ roomId, user_id }) => {
            try {

                if (user_id != socket.verified_id) {
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                const room = await Room.findOne({ roomId });
                // console.log("room", room);
                // console.log("user_id", user_id);
                if (!room || room.adminId.toString() !== user_id.toString()) return;
                // console.log("user_id", user_id);
                if (room.players.length < 2) return socket.emit("error", { message: "Min 2 players required!" });


                const gameWallet = await GameWallet.findOne({
                    _id: room.gamelobby_id
                }).lean();

                if (!gameWallet) {
                    return socket.emit("error", { message: "Game wallet not found" });
                }

                const entryCoins = gameWallet.entryCoinsUsed;

                // 🔹 Saare players ke user_id nikaalo
                const userIds = room.players.map(p => p.user_id);

                // 🔥 IMPORTANT: Coins minus (ATOMIC, SAFE)
                const result = await User.updateMany(
                    {
                        user_id: { $in: userIds },
                        coins: { $gte: entryCoins }   // coins sufficient hone chahiye
                    },
                    {
                        $inc: { coins: -entryCoins }
                    }
                );

                // ❌ Agar koi user ke paas coins kam ho
                if (result.modifiedCount !== userIds.length) {
                    return socket.emit("error", {
                        message: "One or more players have insufficient coins"
                    });
                }






                room.status = 'setup';
                await room.save();

                io.to(roomId).emit("setupTicket", { roomId, cardCount: room.cardCount });
            } catch (err) { console.error(err); }
        });




        socket.on("joinGame", async ({ user_id, maxPlayers, cardCount, gamelobby_id }) => {
            try {
                if (user_id != socket.verified_id) {
                    return socket.emit("error", { message: "Unauthorized!" });
                }
                const activeRoom = await Room.findOne({
                    "players.user_id": user_id,
                    status: { $in: ['setup', 'playing'] }
                });
                // if (!activeRoom) return socket.emit("error", { message: "Room not found" });
                if (activeRoom) {
                    const player = activeRoom.players.find(p => p.user_id === user_id);
                    player.socketId = socket.id;

                    if (disconnectionTimers[user_id]) {
                        clearTimeout(disconnectionTimers[user_id]);
                        delete disconnectionTimers[user_id];
                    }

                    await activeRoom.save();
                    socket.join(activeRoom.roomId);

                    return socket.emit("rejoinSuccess", {
                        roomId: activeRoom.roomId,
                        status: activeRoom.status,
                        turn: activeRoom.turn,
                        calledNumbers: activeRoom.calledNumbers,
                        players: activeRoom.players,

                    });
                }

                // console.log("user_id", user_id);
                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                const count = Number(cardCount) || 1;
                const playersNeeded = Number(maxPlayers);
                const roomKey = `${playersNeeded}_${count}`;
                // console.log("roomKey", roomKey);
                // console.log("waitingRooms", waitingRooms);
                if (!waitingRooms.has(roomKey)) {
                    // console.log("waitingRooms", roomKey);
                    waitingRooms.set(roomKey, { players: [], botTimer: null });

                    // 30 Seconds Timer for Bot
                    const timer = setTimeout(async () => {
                        const rData = waitingRooms.get(roomKey);
                        if (rData && rData.players.length > 0 && rData.players.length < playersNeeded) {
                            // Add Bot from RandomUser
                            const randomBots = await RandomUser.aggregate([{ $sample: { size: playersNeeded - rData.players.length } }]);

                            randomBots.forEach(botDoc => {
                                rData.players.push({
                                    user_id: botDoc._id.toString(),
                                    name: botDoc.username,
                                    socketId: null,
                                    avatar: botDoc.avatar,
                                    tickets: generateBotTicket(),
                                    isReady: true,
                                    bot: true,
                                    completedLines: [0],
                                    markedNumbers: [[]],

                                });
                            });

                            // Start game with Bot
                            createAndStartRoom(roomKey, rData, playersNeeded, count, gamelobby_id);
                        }
                    }, 15000); // 15 seconds wait

                    waitingRooms.get(roomKey).botTimer = timer;
                }

                const roomData = waitingRooms.get(roomKey);
                const existingPlayer = roomData.players.find((p) => p.user_id === user_id);
                if (existingPlayer) {
                    // console.log("Updating socketId for waiting player:", user_id);
                    existingPlayer.socketId = socket.id; // Naya socket update karein

                    // Ab user ko latest waiting count bhej dein
                    return socket.emit("waiting", {
                        currentPlayers: roomData.players.length,
                        maxPlayers: playersNeeded
                    });
                }
                if (roomData.players.find((p) => p.user_id === user_id)) return;
                // console.log("roomData", roomData);
                roomData.players.push({
                    user_id: user.user_id,
                    name: user.username,
                    socketId: socket.id,
                    avatar: user.avatar,
                    hasUsedPower: user.power > 0 ? false : true,
                    tickets: [],
                    isReady: false,
                    bot: false
                });

                if (roomData.players.length === playersNeeded) {
                    clearTimeout(roomData.botTimer);
                    createAndStartRoom(roomKey, roomData, playersNeeded, count, gamelobby_id);
                } else {
                    io.to(user_id).emit("waiting", { currentPlayers: roomData.players.length, maxPlayers: playersNeeded });
                }
            } catch (err) { console.error("Join Error:", err); }
        });



        async function createAndStartRoom(roomKey, roomData, playersNeeded, count, gamelobby_id) {
            const roomId = "BINGO_" + Date.now();
            // console.log("roomId", roomId);
            const newRoom = new Room({
                roomId: roomId,
                players: roomData.players,
                maxPlayers: playersNeeded,
                cardCount: count,
                status: 'setup',
                gamelobby_id: gamelobby_id
            });
            await newRoom.save();
            // console.log("newRoom", newRoom.players);
            roomData.players.forEach(p => {
                if (p.socketId) {
                    const s = io.sockets.sockets.get(p.socketId);
                    if (s) s.join(roomId);
                }
            });

            // --- STEP: Data filter karein taaki faltu fields na jayein ---
            const cleanedPlayers = roomData.players.map(p => {
                // 'tickets', 'completedLines', aur 'markedNumbers' ko bahar nikala
                // baaki jo bacha (name, user_id, avatar etc.) wo 'rest' mein aa gaya
                const { tickets, completedLines, markedNumbers, ...rest } = p;
                return rest;
            });
            // console.log("cleanedPlayers", cleanedPlayers);
            // Ab 'players: cleanedPlayers' pass karein
            io.to(roomId).emit("setupTicket", {
                roomId,
                cardCount: count,
                players: cleanedPlayers
            });

            waitingRooms.delete(roomKey);
            }
            // socket.on("submitTicket", async ({ user_id, roomId, tickets }) => {
            //     try {
            //                 if (user_id != socket.verified_id) {
            //   return socket.emit("error", { message: "Unauthorized!" });
            // }
            //         const room = await Room.findOne({ roomId });
            //         if (!room) return;

            //         const player = room.players.find(p => p.user_id === user_id);
            //         if (player) {
            //             player.tickets = tickets;
            //             player.isReady = true;
            //             player.markedNumbers = tickets.map(() => []);
            //             player.completedLines = tickets.map(() => 0);
            //         }

            //         await room.save();

            //         const allReady = room.players.every(p => p.isReady);
            //         console.log("allReady",allReady)
            //         if (allReady) {
            //             const lobby = await GameWallet.findById(room.gamelobby_id);
            //             const entryFee = lobby ? lobby.entryCoinsUsed : 0;
            //             console.log("entryFee",entryFee)
            //             if (entryFee > 0) {
            //                 const realPlayerIds = room.players
            //                     .filter(p => !p.bot)
            //                     .map(p => p.user_id);

            //                 // Bulk update: Sabhi players ke coins ek saath deduct karein
            //                 await User.updateMany(
            //                     { user_id: { $in: realPlayerIds } },
            //                     { $inc: { coins: -entryFee } }
            //                 );
            //             }

            //             room.status = 'playing';
            //             const firstPlayer = room.players[0];
            //             room.turn = firstPlayer.user_id;
            //             await room.save();

            //             io.to(roomId).emit("gameStarted", {
            //                 roomId: roomId,
            //                 players: room.players,
            //                 status: 'playing',
            //                 turn: room.turn,
            //                 calledNumbers: []
            //             });

            //             // Agar pehla turn Bot ka hai
            //             if (firstPlayer.bot) {
            //                 handleBotTurn(roomId, firstPlayer.user_id, io);
            //             } else {
            //                 startTurnTimer(roomId, firstPlayer.user_id, io);
            //             }
            //         } else {
            //             socket.emit("waitingForOpponent", { message: "Opponent is still filling their cards..." });
            //         }
            //     } catch (err) { console.error("Submit Error:", err); }
            // });

            socket.on("submitTicket", async ({ user_id, roomId, tickets }) => {
                try {
                    if (user_id != socket.verified_id) {
                        return socket.emit("error", { message: "Unauthorized!" });
                    }

                    // 1. Document ko fetch karein
                    const room = await Room.findOne({ roomId });
                    if (!room) return;

                    // 2. Player updates (In-memory changes)
                    const player = room.players.find(p => p.user_id.toString() === user_id.toString());
                    console.log("player",player)
                    if (player) {
                        player.tickets = tickets;
                        player.isReady = true;
                        player.markedNumbers = tickets.map(() => []);
                        player.completedLines = tickets.map(() => 0);
                    }

                    // 3. Check if all players are ready BEFORE saving
                    const allReady = room.players.every(p => p.isReady);
                    console.log("allReady",allReady)
                    if (allReady) {
                        const lobby = await GameWallet.findById(room.gamelobby_id);
                        const entryFee = lobby ? lobby.entryCoinsUsed : 0;

                        if (entryFee > 0) {
                            const realPlayerIds = room.players
                                .filter(p => !p.bot)
                                .map(p => p.user_id);

                            await User.updateMany(
                                { user_id: { $in: realPlayerIds } },
                                { $inc: { coins: -entryFee } }
                            );
                        }

                        room.status = 'playing';
                        const firstPlayer = room.players[0];
                        room.turn = firstPlayer.user_id;
                    }

                    // 4. SIRF EK BAAR SAVE KAREIN
                    // Isse VersionError ke chances khatam ho jayenge
                    await room.save();

                    // 5. Logic execution after save
                    if (allReady) {
                        io.to(roomId).emit("gameStarted", {
                            roomId: roomId,
                            players: room.players,
                            status: 'playing',
                            turn: room.turn,
                            calledNumbers: []
                        });

                        const firstPlayer = room.players[0];
                        if (firstPlayer.bot) {
                            handleBotTurn(roomId, firstPlayer.user_id, io);
                        } else {
                            startTurnTimer(roomId, firstPlayer.user_id, io);
                        }
                    } else {
                        socket.emit("waitingForOpponent", { message: "Opponent is still filling their cards..." });
                    }

                } catch (err) {
                    console.error("Submit Error:", err);
                    // Agar fir bhi error aaye to retry logic ya user ko inform karein
                }
            });


            function startTurnTimer(roomId, nextUserId, io, isPower = false,) {
                // console.log("room",roomId)
                if (turnTimeouts[roomId]) clearTimeout(turnTimeouts[roomId]);

                turnTimeouts[roomId] = setTimeout(async () => {
                    try {
                        const room = await Room.findOne({ roomId });
                        if (!room || room.turn !== nextUserId || room.status !== 'playing') return;

                        const playerIdx = room.players.findIndex(p => p.user_id === nextUserId);
                        const player = room.players[playerIdx];
                        // console.log("player",player)
                        // 1st Time Miss: Auto-Call Number
                        if (!player.missedTurns || player.missedTurns < 1) {
                            player.missedTurns = (player.missedTurns || 0) + 1;

                            // Bot logic use karke ek random number uthayein jo ticket mein ho
                            let availableNumbers = player.tickets[0].flat().filter(n => !room.calledNumbers.includes(n));
                            const autoNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];

                            console.log(`Auto-calling for ${nextUserId}`);
                            await processMove(room, autoNumber, nextUserId, io, isPower);
                        }
                        // 2nd Time Miss: Opponent Wins
                        else {
                            room.status = 'finished';
                            // console.log("status",room.status)
                            // Saamne wala winner (2 players case mein index 0 ka 1, aur 1 ka 0)
                            const winnerIndex = (playerIdx + 1) % room.players.length;
                            const winner = room.players[winnerIndex];

                            room.winner = winner.name;
                            await room.save();
                            await Room.deleteOne({ roomId: room.roomId });

                            io.to(roomId).emit("gameOver", {
                                winner: winner.name,
                                user_id: winner.user_id,
                                reason: "Opponent missed turns twice."
                            });



                            const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });
                            if (!wallet) return;

                            // 🔹 winner coins ADD (not replace)
                            await User.findOneAndUpdate(
                                { user_id: winner.user_id },
                                {
                                    $inc: {
                                        coins: wallet.coinsWon, // ex: 400
                                        diamonds: wallet.diamondsWon
                                    }
                                },
                                { new: true }
                            );
                        }
                    } catch (e) { console.error("Timer Error:", e); }
                }, 30000);
            }
            // async function processMove(room, number, user_id, io) {
            //     const roomId = room.roomId;
            //     // console.log("number",number)
            //     if (!room.calledNumbers.includes(number)) {
            //         room.calledNumbers.push(number);
            //     }

            //     const playersProgress = room.players.map(player => {
            //         player.tickets.forEach((ticket, tIdx) => {
            //             player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
            //         });
            //         return { user_id: player.user_id, completedLines: player.completedLines };
            //     });

            //     const currentIndex = room.players.findIndex(p => p.user_id === user_id);
            //     const nextPlayer = room.players[(currentIndex + 1) % room.players.length];
            //     room.turn = nextPlayer.user_id;

            //     await room.save();
            //     // console.log("playersProgress",playersProgress)
            //     io.to(roomId).emit("numberCalled", {
            //         number: number,
            //         turn: room.turn,
            //         players: playersProgress
            //     });

            //     if (nextPlayer.bot) {
            //         handleBotTurn(roomId, nextPlayer.user_id, io);
            //     } else {
            //         // console.log("roomId",roomId ,nextPlayer.user_id)
            //         startTurnTimer(roomId, nextPlayer.user_id, io);
            //     }
            // }
            async function processMove(room, number, user_id, io, isPower = false) {
                const roomId = room.roomId;
                const currentIndex = room.players.findIndex(p => p.user_id === user_id);
                const currentPlayer = room.players[currentIndex];

                // 1. Numbers add aur progress check
                if (!room.calledNumbers.includes(number)) {
                    room.calledNumbers.push(number);
                }

                // 2. Logic for Power and Turn Management
                let shouldChangeTurn = true;

                if (isPower && !currentPlayer.hasUsedPower) {
                    // Agar player ne power button dabaya hai aur uske paas power bachi hai
                    if (currentPlayer.powerTurnCount === 0) {
                        currentPlayer.powerTurnCount = 1; // Pehla turn count karo
                        currentPlayer.hasUsedPower = true,
                            shouldChangeTurn = false;         // Turn change NAHI hoga
                    }
                } else if (currentPlayer.powerTurnCount === 1) {
                    // Player apna extra turn chal chuka hai
                    currentPlayer.powerTurnCount = 0;
                    currentPlayer.hasUsedPower = true;    // AB power permanently khatam
                    shouldChangeTurn = true;


                    const updatedUser = await User.findOneAndUpdate({
                        user_id, power: { $gt: 0 }
                    }, { $inc: { power: -1 } }, { new: true });

                    // Ab turn change hoga
                } else {
                    // Normal move logic
                    shouldChangeTurn = true;
                }

                // 3. Sabhi players ka updated data (including power status) taiyar karein
                const playersProgress = room.players.map(player => {
                    // Har ticket ke liye bingo lines check karein
                    player.tickets.forEach((ticket, tIdx) => {
                        player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
                    });

                    return {
                        user_id: player.user_id,
                        completedLines: player.completedLines,
                        hasUsedPower: player.hasUsedPower, // Frontend ko batane ke liye ki button hide/disable karna hai
                        powerTurnCount: player.powerTurnCount // Debugging ya UI ke liye
                    };
                });

                // 4. Turn change management
                if (shouldChangeTurn) {
                    const nextIndex = (currentIndex + 1) % room.players.length;
                    room.turn = room.players[nextIndex].user_id;
                } else {
                    room.turn = currentPlayer.user_id; // Turn wapas usi ko do
                }

                await room.save();

                // 5. Frontend ko data bhejein
                io.to(roomId).emit("numberCalled", {
                    number: number,
                    turn: room.turn,
                    players: playersProgress, // Isme ab hasUsedPower property ja rahi hai
                });

                // 6. Next Turn Timer/Bot logic
                const activePlayer = room.players.find(p => p.user_id === room.turn);
                if (activePlayer.bot) {
                    handleBotTurn(roomId, activePlayer.user_id, io);
                } else {
                    // Note: startTurnTimer mein check karein ki wo turn skip na kar de
                    startTurnTimer(roomId, activePlayer.user_id, io, isPower);
                }
            }
            const handleBotTurn = async (roomId, botUserId, io) => {
                const delay = Math.floor(Math.random() * 3000) + 2000; // 2 to 5 seconds delay

                setTimeout(async () => {
                    try {
                        const room = await Room.findOne({ roomId });
                        if (!room || room.status !== 'playing' || room.turn !== botUserId) return;

                        const botPlayer = room.players.find(p => p.user_id === botUserId);
                        const chosenNumber = getBotDecision(botPlayer, room);

                        if (chosenNumber) {
                            room.calledNumbers.push(chosenNumber);

                            // Line Update Logic
                            room.players.forEach(player => {
                                player.tickets.forEach((ticket, tIdx) => {
                                    player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
                                });
                            });

                            const playersProgress = room.players.map(player => {
                                player.tickets.forEach((ticket, tIdx) => {
                                    player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
                                });

                                // Sirf id aur completedLines return kar rahe hain
                                return {
                                    user_id: player.user_id,
                                    completedLines: player.completedLines
                                };
                            });

                            const currentIndex = room.players.findIndex(p => p.user_id === botUserId);
                            const nextPlayer = room.players[(currentIndex + 1) % room.players.length];
                            room.turn = nextPlayer.user_id;

                            await room.save();

                            io.to(roomId).emit("numberCalled", { number: chosenNumber, turn: room.turn, players: playersProgress });

                            if (nextPlayer.bot) {
                                handleBotTurn(roomId, nextPlayer.user_id, io);
                            } else {
                                startTurnTimer(roomId, nextPlayer.user_id, io);
                            }
                        }
                    } catch (err) { console.error("Bot Turn Error:", err); }
                }, delay);
            };
            socket.on("userpowercheck", async ({ roomId, user_id }) => {
                try {

                    if (user_id != socket.verified_id) {
                        return socket.emit("error", { message: "Unauthorized!" });
                    }
                    const room = await Room.findOne({ roomId });

                    if (!room) {
                        return socket.emit("userpowercheck", {
                            canUsePower: false,
                            message: "Room not found"
                        });
                    }

                    // 1. Room ke players mein se current user ko dhoondhen
                    const player = room.players.find(p => p.user_id === user_id);

                    if (!player) {
                        return socket.emit("userpowercheck", {
                            canUsePower: false,
                            message: "Player not found"
                        });
                    }

                    // 2. Conditions check karein:
                    // - Kya uski turn hai?
                    // - Kya usne pehle power use kar li hai?
                    // - Kya game abhi chal raha hai?
                    const isHisTurn = room.turn === user_id;
                    const alreadyUsed = player.hasUsedPower;
                    const isPlaying = room.status === 'playing';

                    let canUse = false;
                    let msg = "";

                    if (!isPlaying) {
                        msg = "Game is not active.";
                    } else if (!isHisTurn) {
                        msg = "Wait for your turn.";
                    } else if (alreadyUsed) {
                        msg = "You have already used your power once!";
                    } else {
                        canUse = true;
                        msg = "Power available!";
                    }

                    // 3. Response bhejein
                    socket.emit("userpowercheck", {
                        canUsePower: canUse,
                        message: msg
                    });

                } catch (err) {
                    console.error("Power Check Error:", err);
                    socket.emit("userpowercheck", { canUsePower: false, message: "Server error" });
                }
            });
            socket.on("callNumber", async ({ roomId, number, user_id, isPower }) => { // isPower flag add kiya
                try {
                    if (user_id != socket.verified_id) {
                        return socket.emit("error", { message: "Unauthorized!" });
                    }


                    if (turnTimeouts[roomId]) {
                        clearTimeout(turnTimeouts[roomId]);
                        delete turnTimeouts[roomId];
                    }

                    const room = await Room.findOne({ roomId });
                    if (!room || room.turn !== user_id || room.status !== 'playing') return;

                    const currentPlayer = room.players.find(p => p.user_id === user_id);
                    if (currentPlayer) currentPlayer.missedTurns = 0;

                    // Pass isPower to processMove
                    await processMove(room, number, user_id, io, isPower);

                } catch (err) { console.error(err); }
            });
            // socket.on("callNumber", async ({ roomId, number, user_id }) => {
            //     try {
            //         // Move aayi toh timer clear karein
            //         if (turnTimeouts[roomId]) {
            //             clearTimeout(turnTimeouts[roomId]);
            //             delete turnTimeouts[roomId];
            //         }

            //         const room = await Room.findOne({ roomId });
            //         if (!room || room.turn !== user_id || room.status !== 'playing') return;

            //         // Player ne move chal di, isliye missedTurns reset karein
            //         const currentPlayer = room.players.find(p => p.user_id === user_id);
            //         if (currentPlayer) currentPlayer.missedTurns = 0;

            //         await processMove(room, number, user_id, io);

            //     } catch (err) { console.error(err); }
            // });
            socket.on("claimBingo", async ({ roomId, user_id }) => {
                try {

                    if (user_id != socket.verified_id) {
                        return socket.emit("error", { message: "Unauthorized!" });
                    }
                    const room = await Room.findOne({ roomId });
                    if (!room || room.status !== 'playing') return;

                    const player = room.players.find(p => p.user_id === user_id);
                    if (player && player.completedLines.some(l => l >= 5)) {
                        room.status = 'finished';
                        room.winner = player.name;
                        await room.save();
                        io.to(roomId).emit("gameOver", { winner: player.name, user_id: player.user_id });
                        await Room.deleteOne({ roomId: room.roomId });
                        const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                        // console.log("wallet",wallet)
                        if (!wallet) return;

                        // 🔹 winner coins ADD (not replace)
                        await User.findOneAndUpdate(
                            { user_id: player.user_id },
                            {
                                $inc: {
                                    coins: wallet.coinsWon, // ex: 400
                                    diamonds: wallet.diamondsWon
                                }
                            },
                            { new: true }
                        );

                    }
                } catch (err) { console.error(err); }
            });


        });

};