const { Server } = require("socket.io");
const Room = require("../Models/Room");
const User = require("../Models/Users");
const GameWallet = require("../Models/GameWallet");
const RandomUser = require("../Models/RandomUser");
const ActionLog = require("../Models/Log");
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
        // socket.on("disconnect", async () => {
        //     try {
        //         console.log("User disconnected:", socket.id);
        //         const room = await Room.findOne({ "players.socketId": socket.id, status: 'playing' });
        //         if (!room) return socket.emit("error", { message: "Room not found" });


        //         const player = room.players.find(p => p.socketId === socket.id);
        //         if (!player) return socket.emit("error", { message: "User not found" });

        //         const user_id = player.user_id;
        //         const roomId = room.roomId;

        //         // console.log(`User ${user_id} disconnected. Starting 1-min win timer...`);
        //         io.to(roomId).emit("playerOffline", { user_id, message: "Opponent disconnected. Winning in 60s if not rejoined." });

        //         // 1 Minute (60000ms) Timer Start
        //         disconnectionTimers[user_id] = setTimeout(async () => {
        //             const currentRoom = await Room.findOne({ roomId, status: 'playing' });
        //             if (!currentRoom) return;

        //             const winner = currentRoom.players.find(p => p.user_id !== user_id);

        //             currentRoom.status = 'finished';
        //             currentRoom.winner = winner ? winner.username : "System";
        //             await currentRoom.save();
        //             await Room.deleteOne({ roomId: currentRoom.roomId });
        //             io.to(roomId).emit("gameOver", {
        //                 winner: currentRoom.winner,
        //                 user_id: winner ? winner.user_id : null,
        //                 reason: "Opponent failed to rejoin within 1 minute."
        //             });

        //             const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });
        //             if (!wallet) return socket.emit("error", { message: "wallet not found" });


        //             // 🔹 winner coins ADD (not replace)
        //             await User.findOneAndUpdate(
        //                 { user_id: winner.user_id },
        //                 {
        //                     $inc: {
        //                         coins: wallet.coinsWon, // ex: 400
        //                         diamonds: wallet.diamondsWon
        //                     }
        //                 },
        //                 { new: true }
        //             );


        //             // await Room.deleteOne({ roomId: roomId });
        //             delete disconnectionTimers[user_id];
        //         }, 60000);

        //     } catch (err) { console.error("Disconnect Error:", err); }
        // });
        socket.on("disconnect", async () => {
            try {
                // Find room where player was active
                const room = await Room.findOne({ "players.socketId": socket.id, status: 'playing' });

                if (!room) {
                    // Agar room nahi mila, toh silent return ya simple log (No DB action needed usually)
                    return;
                }

                const player = room.players.find(p => p.socketId === socket.id);
                if (!player) return;

                const user_id = player.user_id;
                const roomId = room.roomId;

                // --- STEP 1: LOG DISCONNECTION ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: user_id,
                    userName: player.username,
                    event: "USER_DISCONNECTED",
                    details: {
                        socketId: socket.id,
                        message: "Starting 60s win timer"
                    }
                });

                io.to(roomId).emit("playerOffline", {
                    user_id,
                    message: "Opponent disconnected. Winning in 60s if not rejoined."
                });

                // 1 Minute Timer Start
                disconnectionTimers[user_id] = setTimeout(async () => {
                    const currentRoom = await Room.findOne({ roomId, status: 'playing' });
                    if (!currentRoom) return;

                    const winner = currentRoom.players.find(p => p.user_id !== user_id);

                    // Update Room Status
                    currentRoom.status = 'finished';
                    currentRoom.winner = winner ? winner.username : "System";
                    await currentRoom.save();

                    // --- STEP 2: LOG TIMEOUT WINNER ---
                    await ActionLog.create({
                        roomId: roomId,
                        userId: "SYSTEM",
                        event: "DISCONNECT_TIMEOUT_FINISH",
                        details: {
                            loser_id: user_id,
                            winner_id: winner ? winner.user_id : null,
                            winner_name: currentRoom.winner,
                            reason: "60s Rejoin Timeout"
                        }
                    });

                    await Room.deleteOne({ roomId: currentRoom.roomId });

                    io.to(roomId).emit("gameOver", {
                        winner: currentRoom.winner,
                        user_id: winner ? winner.user_id : null,
                        reason: "Opponent failed to rejoin within 1 minute."
                    });

                    // Wallet & Coins Update
                    const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });
                    if (wallet && winner) {
                        await User.findOneAndUpdate(
                            { user_id: winner.user_id },
                            {
                                $inc: {
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon
                                }
                            },
                            { new: true }
                        );

                        // --- STEP 3: LOG REWARD SUCCESS ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: winner.user_id,
                            event: "REWARD_ADDED_DISCONNECT",
                            details: {
                                coins: wallet.coinsWon,
                                diamonds: wallet.diamondsWon
                            }
                        });
                    }

                    delete disconnectionTimers[user_id];
                }, 60000);

            } catch (err) {
                // --- LOG ERROR ---
                await ActionLog.create({
                    roomId: "SYSTEM_ERROR",
                    userId: "SERVER",
                    event: "DISCONNECT_CATCH_ERROR",
                    details: { error: err.message }
                });
            }
        });

        // socket.on("createPrivateRoom", async ({ user_id, cardCount, gamelobby_id }) => {
        //     try {
        //         if (user_id != socket.verified_id) {
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }
        //         const user = await User.findOne({ user_id }).lean();
        //         if (!user) return;

        //         const joinKey = Math.random().toString(36).substring(2, 8).toUpperCase();
        //         const roomId = "PVT_" + Date.now();

        //         const joinUrl = `${BASE_URL}join/${joinKey}`;

        //         const newRoom = new Room({
        //             roomId: roomId,
        //             joinKey: joinKey,
        //             joinUrl: joinUrl,
        //             gamelobby_id: gamelobby_id,
        //             isPrivate: true,
        //             adminId: user_id,
        //             cardCount: Number(cardCount) || 1,
        //             maxPlayers: 10,
        //             players: [{
        //                 user_id: user.user_id,
        //                 name: user.username,
        //                 socketId: socket.id,
        //                 avatar: user.avatar,
        //                 isReady: false,
        //                 hasUsedPower: user.power > 0 ? false : true
        //             }]
        //         });

        //         await newRoom.save();
        //         socket.join(roomId);
        //         socket.emit("createPrivateRoom", { joinKey, joinUrl, roomId, players: newRoom.players, adminId: user_id });
        //     } catch (err) { console.error(err); }
        // });


        socket.on("createPrivateRoom", async ({ user_id, cardCount, gamelobby_id }) => {
            try {
                console.log("createPrivateRoom user_id")
                if (user_id != socket.verified_id) {
                    // --- NAYA LOG: Unauthorized Attempt ---
                    await ActionLog.create({
                        roomId: "N/A",
                        userId: user_id,
                        event: "UNAUTHORIZED_ROOM_CREATE_ATTEMPT",
                        details: { socket_verified_id: socket.verified_id, msg: "User ID mismatch" }
                    });
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                const user = await User.findOne({ user_id }).lean();
                if (!user) return;

                const joinKey = Math.floor(1000 + Math.random() * 9000).toString();
                const roomId = "PVT_" + Date.now();
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

                // --- NAYA LOG: Room Created Successfully ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: user_id,
                    userName: user.username,
                    event: "PRIVATE_ROOM_CREATED",
                    details: {
                        joinKey: joinKey,
                        cardCount: cardCount,
                        gamelobby_id: gamelobby_id
                    }
                });

                socket.join(roomId);
                socket.emit("createPrivateRoom", { joinKey, joinUrl, roomId, players: newRoom.players, adminId: user_id });

            } catch (err) {
                // --- NAYA LOG: Catch Block Error ---
                await ActionLog.create({
                    roomId: "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "CREATE_ROOM_ERROR",
                    details: { error: err.message }
                });
                console.error(err);
            }
        });


        // socket.on("joinPrivateRoom", async ({ user_id, joinKey }) => {
        //     try {

        //         if (user_id != socket.verified_id) {
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }
        //         // console.log('currentPlayer')
        //         let room = await Room.findOne({ joinKey });
        //         if (!room) return socket.emit("error", { message: "Room not found!" });
        //         const player = room.players.find(p => p.user_id === user_id);
        //         // if (room.status !== 'waiting') return socket.emit("error", { message: "Room not found or game started!" });

        //         if (player) {
        //             // REJOIN LOGIC: Agar player pehle se hai, toh socket update karo
        //             player.socketId = socket.id;

        //             // 1-min timer cancel karein
        //             if (disconnectionTimers[user_id]) {
        //                 clearTimeout(disconnectionTimers[user_id]);
        //                 delete disconnectionTimers[user_id];
        //             }

        //             await room.save();
        //             socket.join(room.roomId);

        //             // Agar game chal raha hai toh state bhejein
        //             if (room.status == 'waiting' || room.status == 'setup' || room.status == 'playing') {
        //                 return socket.emit("rejoinSuccess", {
        //                     roomId: room.roomId,
        //                     joinKey: room.joinKey,
        //                     joinUrl: room.joinUrl,
        //                     status: room.status,
        //                     turn: room.turn,
        //                     calledNumbers: room.calledNumbers,
        //                     players: room.players,
        //                     cardCount: room.cardCount,
        //                     adminId: room.adminId
        //                 });
        //             } else if (room.status == 'finished') {
        //                 const winnerData = room.players.find(p => p.name === room.winner);
        //                 await Room.deleteOne({ roomId: room.roomId });
        //                 return socket.emit("gameOver", {
        //                     winner: room.winner,
        //                     user_id: winnerData ? winnerData.user_id : null,
        //                     reason: "Opponent failed to rejoin within 1 minute or game ended."
        //                 });

        //             }
        //         } else {
        //             // const room = await Room.findOne({ joinKey, status: 'waiting' });

        //             if (!room) return socket.emit("error", { message: "Room not found or game started!" });
        //             if (room.players.length >= 10) return socket.emit("error", { message: "Room is full!" });

        //             const user = await User.findOne({ user_id }).lean();
        //             console.log("user", user);
        //             if (room.players.find(p => p.user_id.toString() === user_id.toString())) return;
        //             console.log("user data", user);
        //             room.players.push({
        //                 user_id: user.user_id,
        //                 name: user.username,
        //                 socketId: socket.id,
        //                 avatar: user.avatar,
        //                 isReady: false,
        //                 hasUsedPower: user.power > 0 ? false : true
        //             });
        //             // console.log("room", room.players.length);
        //             await room.save();
        //             socket.join(room.roomId);
        //             io.to(room.roomId).emit("joinPrivateRoom", { joinKey: room.joinKey, joinUrl: room.joinUrl, roomId: room.roomId, players: room.players, totalPlayer: room.players.lenth, adminId: room.adminId });
        //         }
        //     } catch (err) { console.error(err); }
        // });


        socket.on("joinPrivateRoom", async ({ user_id, joinKey }) => {
            try {
                if (user_id != socket.verified_id) {
                    // --- NAYA LOG: Unauthorized join attempt ---
                    await ActionLog.create({
                        roomId: "N/A",
                        userId: user_id,
                        event: "UNAUTHORIZED_JOIN_ATTEMPT",
                        details: { socket_verified_id: socket.verified_id, joinKey }
                    });
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                let room = await Room.findOne({ joinKey });

                if (!room) {
                    // --- NAYA LOG: Room not found ---
                    await ActionLog.create({
                        roomId: "N/A",
                        userId: user_id,
                        event: "JOIN_ROOM_FAILED",
                        details: { joinKey, reason: "Room not found" }
                    });
                    return socket.emit("error", { message: "Room not found!" });
                }

                const player = room.players.find(p => p.user_id === user_id);

                if (player) {
                    // REJOIN LOGIC
                    player.socketId = socket.id;

                    // 1-min timer cancel karein
                    if (disconnectionTimers[user_id]) {
                        clearTimeout(disconnectionTimers[user_id]);
                        delete disconnectionTimers[user_id];

                        // --- NAYA LOG: Rejoin and Timer Cancelled ---
                        await ActionLog.create({
                            roomId: room.roomId,
                            userId: user_id,
                            userName: player.name,
                            event: "PLAYER_REJOINED",
                            details: { msg: "Disconnection timer cleared", status: room.status }
                        });
                    }

                    await room.save();
                    socket.join(room.roomId);

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
                    // NEW JOIN LOGIC
                    if (room.players.length >= 10) {
                        return socket.emit("error", { message: "Room is full!" });
                    }

                    const user = await User.findOne({ user_id }).lean();
                    if (room.players.find(p => p.user_id.toString() === user_id.toString())) return;

                    room.players.push({
                        user_id: user.user_id,
                        name: user.username,
                        socketId: socket.id,
                        avatar: user.avatar,
                        isReady: false,
                        hasUsedPower: user.power > 0 ? false : true
                    });

                    await room.save();

                    // --- NAYA LOG: New Player Joined ---
                    await ActionLog.create({
                        roomId: room.roomId,
                        userId: user_id,
                        userName: user.username,
                        event: "NEW_PLAYER_JOINED",
                        details: { playerCount: room.players.length }
                    });

                    socket.join(room.roomId);
                    io.to(room.roomId).emit("joinPrivateRoom", {
                        joinKey: room.joinKey,
                        joinUrl: room.joinUrl,
                        roomId: room.roomId,
                        players: room.players,
                        totalPlayer: room.players.length,
                        adminId: room.adminId
                    });
                }
            } catch (err) {
                // --- NAYA LOG: Catch block error ---
                await ActionLog.create({
                    roomId: "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "JOIN_PRIVATE_ROOM_ERROR",
                    details: { error: err.message }
                });
                console.error(err);
            }
        });

        // --- NEW: START PRIVATE GAME (ADMIN ONLY) ---
        // socket.on("startPrivateGame", async ({ roomId, user_id }) => {
        //     try {

        //         if (user_id != socket.verified_id) {
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }

        //         const room = await Room.findOne({ roomId });
        //         // console.log("room", room);
        //         // console.log("user_id", user_id);
        //         if (!room || room.adminId.toString() !== user_id.toString()) return;
        //         // console.log("user_id", user_id);
        //         if (room.players.length < 2) return socket.emit("error", { message: "Min 2 players required!" });


        //         const gameWallet = await GameWallet.findOne({
        //             _id: room.gamelobby_id
        //         }).lean();

        //         if (!gameWallet) {
        //             return socket.emit("error", { message: "Game wallet not found" });
        //         }

        //         const entryCoins = gameWallet.entryCoinsUsed;

        //         // 🔹 Saare players ke user_id nikaalo
        //         const userIds = room.players.map(p => p.user_id);

        //         // 🔥 IMPORTANT: Coins minus (ATOMIC, SAFE)
        //         const result = await User.updateMany(
        //             {
        //                 user_id: { $in: userIds },
        //                 coins: { $gte: entryCoins }   // coins sufficient hone chahiye
        //             },
        //             {
        //                 $inc: { coins: -entryCoins }
        //             }
        //         );

        //         // ❌ Agar koi user ke paas coins kam ho
        //         if (result.modifiedCount !== userIds.length) {
        //             return socket.emit("error", {
        //                 message: "One or more players have insufficient coins"
        //             });
        //         }






        //         room.status = 'setup';
        //         await room.save();

        //         io.to(roomId).emit("setupTicket", { roomId, cardCount: room.cardCount });
        //     } catch (err) { console.error(err); }
        // });


        socket.on("startPrivateGame", async ({ roomId, user_id }) => {
            try {
                console.log("startPrivateGame user_id", user_id)
                if (user_id != socket.verified_id) {
                    // --- NAYA LOG: Unauthorized Start Attempt ---
                    await ActionLog.create({
                        roomId: roomId || "N/A",
                        userId: user_id,
                        event: "UNAUTHORIZED_START_ATTEMPT",
                        details: { socket_verified_id: socket.verified_id, msg: "Not the verified socket user" }
                    });
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                const room = await Room.findOne({ roomId });

                if (!room || room.adminId.toString() !== user_id.toString()) {
                    // --- NAYA LOG: Not Admin or Room Missing ---
                    await ActionLog.create({
                        roomId: roomId,
                        userId: user_id,
                        event: "START_GAME_DENIED",
                        details: { reason: !room ? "Room not found" : "User is not Admin" }
                    });
                    return;
                }

                if (room.players.length < 2) {
                    return socket.emit("error", { message: "Min 2 players required!" });
                }

                const gameWallet = await GameWallet.findOne({
                    _id: room.gamelobby_id
                }).lean();

                if (!gameWallet) {
                    return socket.emit("error", { message: "Game wallet not found" });
                }

                const entryCoins = gameWallet.entryCoinsUsed;
                const userIds = room.players.map(p => p.user_id);

                // 🔥 IMPORTANT: Coins minus (ATOMIC, SAFE)
                const result = await User.updateMany(
                    {
                        user_id: { $in: userIds },
                        coins: { $gte: entryCoins }
                    },
                    {
                        $inc: { coins: -entryCoins }
                    }
                );

                // ❌ Agar koi user ke paas coins kam ho
                if (result.modifiedCount !== userIds.length) {
                    // --- NAYA LOG: Insufficient Coins Error ---
                    await ActionLog.create({
                        roomId: roomId,
                        userId: user_id,
                        event: "COIN_DEDUCTION_FAILED",
                        details: {
                            expected: userIds.length,
                            actual: result.modifiedCount,
                            entryFee: entryCoins
                        }
                    });

                    return socket.emit("error", {
                        message: "One or more players have insufficient coins"
                    });
                }

                // --- NAYA LOG: Successful Coin Deduction ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: "SYSTEM",
                    event: "GAME_COINS_DEDUCTED",
                    details: {
                        playerIds: userIds,
                        totalDeductedPerUser: entryCoins
                    }
                });

                room.status = 'setup';
                await room.save();

                // --- NAYA LOG: Game Status Changed to Setup ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: user_id,
                    event: "PRIVATE_GAME_STARTED",
                    details: { status: "setup", cardCount: room.cardCount }
                });

                io.to(roomId).emit("setupTicket", { roomId, cardCount: room.cardCount });

            } catch (err) {
                // --- NAYA LOG: Catch block error ---
                await ActionLog.create({
                    roomId: roomId || "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "START_GAME_ERROR",
                    details: { error: err.message }
                });
                console.error(err);
            }
        });

        // socket.on("joinGame", async ({ user_id, maxPlayers, cardCount, gamelobby_id }) => {
        //     try {
        //         if (user_id != socket.verified_id) {
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }
        //         const activeRoom = await Room.findOne({
        //             "players.user_id": user_id,
        //             status: { $in: ['setup', 'playing'] }
        //         });
        //         // if (!activeRoom) return socket.emit("error", { message: "Room not found" });
        //         if (activeRoom) {
        //             const player = activeRoom.players.find(p => p.user_id === user_id);
        //             player.socketId = socket.id;

        //             if (disconnectionTimers[user_id]) {
        //                 clearTimeout(disconnectionTimers[user_id]);
        //                 delete disconnectionTimers[user_id];
        //             }

        //             await activeRoom.save();
        //             socket.join(activeRoom.roomId);

        //             return socket.emit("rejoinSuccess", {
        //                 roomId: activeRoom.roomId,
        //                 status: activeRoom.status,
        //                 turn: activeRoom.turn,
        //                 calledNumbers: activeRoom.calledNumbers,
        //                 players: activeRoom.players,

        //             });
        //         }

        //         // console.log("user_id", user_id);
        //         const user = await User.findOne({ user_id }).lean();
        //         if (!user) return socket.emit("error", { message: "User not found" });

        //         const count = Number(cardCount) || 1;
        //         const playersNeeded = Number(maxPlayers);
        //         const roomKey = `${playersNeeded}_${count}`;
        //         // console.log("roomKey", roomKey);
        //         // console.log("waitingRooms", waitingRooms);
        //         if (!waitingRooms.has(roomKey)) {
        //             // console.log("waitingRooms", roomKey);
        //             waitingRooms.set(roomKey, { players: [], botTimer: null });

        //             // 30 Seconds Timer for Bot
        //             const timer = setTimeout(async () => {
        //                 const rData = waitingRooms.get(roomKey);
        //                 if (rData && rData.players.length > 0 && rData.players.length < playersNeeded) {
        //                     // Add Bot from RandomUser
        //                     const randomBots = await RandomUser.aggregate([{ $sample: { size: playersNeeded - rData.players.length } }]);

        //                     randomBots.forEach(botDoc => {
        //                         rData.players.push({
        //                             user_id: botDoc._id.toString(),
        //                             name: botDoc.username,
        //                             socketId: null,
        //                             avatar: botDoc.avatar,
        //                             tickets: generateBotTicket(),
        //                             isReady: true,
        //                             bot: true,
        //                             completedLines: [0],
        //                             markedNumbers: [[]],

        //                         });
        //                     });

        //                     // Start game with Bot
        //                     createAndStartRoom(roomKey, rData, playersNeeded, count, gamelobby_id);
        //                 }
        //             }, 15000); // 15 seconds wait

        //             waitingRooms.get(roomKey).botTimer = timer;
        //         }

        //         const roomData = waitingRooms.get(roomKey);
        //         const existingPlayer = roomData.players.find((p) => p.user_id === user_id);
        //         if (existingPlayer) {
        //             // console.log("Updating socketId for waiting player:", user_id);
        //             existingPlayer.socketId = socket.id; // Naya socket update karein

        //             // Ab user ko latest waiting count bhej dein
        //             return socket.emit("waiting", {
        //                 currentPlayers: roomData.players.length,
        //                 maxPlayers: playersNeeded
        //             });
        //         }
        //         if (roomData.players.find((p) => p.user_id === user_id)) return;
        //         // console.log("roomData", roomData);
        //         roomData.players.push({
        //             user_id: user.user_id,
        //             name: user.username,
        //             socketId: socket.id,
        //             avatar: user.avatar,
        //             hasUsedPower: user.power > 0 ? false : true,
        //             tickets: [],
        //             isReady: false,
        //             bot: false
        //         });

        //         if (roomData.players.length === playersNeeded) {
        //             clearTimeout(roomData.botTimer);
        //             createAndStartRoom(roomKey, roomData, playersNeeded, count, gamelobby_id);
        //         } else {
        //             io.to(user_id).emit("waiting", { currentPlayers: roomData.players.length, maxPlayers: playersNeeded });
        //         }
        //     } catch (err) { console.error("Join Error:", err); }
        // });



        socket.on("joinGame", async ({ user_id, maxPlayers, cardCount, gamelobby_id }) => {
            try {
                console.log("joinGame user_id", user_id)
                if (user_id != socket.verified_id) {
                    // --- NAYA LOG: Unauthorized ---
                    await ActionLog.create({
                        roomId: "N/A",
                        userId: user_id,
                        event: "UNAUTHORIZED_JOIN_ATTEMPT",
                        details: { socket_verified_id: socket.verified_id }
                    });
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                const activeRoom = await Room.findOne({
                    "players.user_id": user_id,
                    status: { $in: ['setup', 'playing'] }
                });

                if (activeRoom) {
                    const player = activeRoom.players.find(p => p.user_id === user_id);
                    player.socketId = socket.id;

                    if (disconnectionTimers[user_id]) {
                        clearTimeout(disconnectionTimers[user_id]);
                        delete disconnectionTimers[user_id];

                        // --- NAYA LOG: Rejoin Re-established ---
                        await ActionLog.create({
                            roomId: activeRoom.roomId,
                            userId: user_id,
                            event: "PUBLIC_PLAYER_REJOINED",
                            details: { status: activeRoom.status, msg: "Rejoin successful, timer cleared" }
                        });
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

                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                const count = Number(cardCount) || 1;
                const playersNeeded = Number(maxPlayers);
                const roomKey = `${playersNeeded}_${count}`;

                if (!waitingRooms.has(roomKey)) {
                    waitingRooms.set(roomKey, { players: [], botTimer: null });

                    // 15 Seconds Timer for Bot
                    const timer = setTimeout(async () => {
                        const rData = waitingRooms.get(roomKey);
                        if (rData && rData.players.length > 0 && rData.players.length < playersNeeded) {
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

                            // --- NAYA LOG: Bot Filling ---
                            await ActionLog.create({
                                roomId: "WAITING_ROOM",
                                userId: "SYSTEM",
                                event: "BOTS_ADDED_TO_GAME",
                                details: { roomKey, botCount: randomBots.length, totalPlayers: rData.players.length }
                            });

                            createAndStartRoom(roomKey, rData, playersNeeded, count, gamelobby_id);
                        }
                    }, 15000);

                    waitingRooms.get(roomKey).botTimer = timer;
                }

                const roomData = waitingRooms.get(roomKey);
                const existingPlayer = roomData.players.find((p) => p.user_id === user_id);

                if (existingPlayer) {
                    existingPlayer.socketId = socket.id;
                    return socket.emit("waiting", {
                        currentPlayers: roomData.players.length,
                        maxPlayers: playersNeeded
                    });
                }

                if (roomData.players.find((p) => p.user_id === user_id)) return;

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

                // --- NAYA LOG: Player Joined Waiting Room ---
                await ActionLog.create({
                    roomId: "WAITING_ROOM",
                    userId: user_id,
                    userName: user.username,
                    event: "JOINED_WAITING_LIST",
                    details: { roomKey, currentPlayers: roomData.players.length, playersNeeded }
                });

                if (roomData.players.length === playersNeeded) {
                    clearTimeout(roomData.botTimer);

                    // --- NAYA LOG: Game Ready ---
                    await ActionLog.create({
                        roomId: "WAITING_ROOM",
                        userId: "SYSTEM",
                        event: "WAITING_ROOM_FULL",
                        details: { roomKey, status: "Starting createAndStartRoom" }
                    });

                    createAndStartRoom(roomKey, roomData, playersNeeded, count, gamelobby_id);
                } else {
                    io.to(user_id).emit("waiting", { currentPlayers: roomData.players.length, maxPlayers: playersNeeded });
                }
            } catch (err) {
                // --- NAYA LOG: Error ---
                await ActionLog.create({
                    roomId: "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "JOIN_GAME_ERROR",
                    details: { error: err.message }
                });
                console.error("Join Error:", err);
            }
        });
        // async function createAndStartRoom(roomKey, roomData, playersNeeded, count, gamelobby_id) {
        //     const roomId = "BINGO_" + Date.now();
        //     // console.log("roomId", roomId);
        //     const newRoom = new Room({
        //         roomId: roomId,
        //         players: roomData.players,
        //         maxPlayers: playersNeeded,
        //         cardCount: count,
        //         status: 'setup',
        //         gamelobby_id: gamelobby_id
        //     });
        //     await newRoom.save();
        //     // console.log("newRoom", newRoom.players);
        //     roomData.players.forEach(p => {
        //         if (p.socketId) {
        //             const s = io.sockets.sockets.get(p.socketId);
        //             if (s) s.join(roomId);
        //         }
        //     });

        //     // --- STEP: Data filter karein taaki faltu fields na jayein ---
        //     const cleanedPlayers = roomData.players.map(p => {
        //         // 'tickets', 'completedLines', aur 'markedNumbers' ko bahar nikala
        //         // baaki jo bacha (name, user_id, avatar etc.) wo 'rest' mein aa gaya
        //         const { tickets, completedLines, markedNumbers, ...rest } = p;
        //         return rest;
        //     });
        //     // console.log("cleanedPlayers", cleanedPlayers);
        //     // Ab 'players: cleanedPlayers' pass karein
        //     io.to(roomId).emit("setupTicket", {
        //         roomId,
        //         cardCount: count,
        //         players: cleanedPlayers
        //     });

        //     waitingRooms.delete(roomKey);
        // }


        async function createAndStartRoom(roomKey, roomData, playersNeeded, count, gamelobby_id) {
            try {
                const roomId = "BINGO_" + Date.now();

                const newRoom = new Room({
                    roomId: roomId,
                    players: roomData.players,
                    maxPlayers: playersNeeded,
                    cardCount: count,
                    status: 'setup',
                    gamelobby_id: gamelobby_id
                });

                await newRoom.save();

                // --- NAYA LOG: Game Room Created ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: "SYSTEM",
                    event: "GAME_ROOM_CREATED",
                    details: {
                        roomKey: roomKey,
                        totalPlayers: roomData.players.length,
                        maxPlayers: playersNeeded,
                        cardCount: count,
                        players: roomData.players.map(p => ({ id: p.user_id, name: p.name, isBot: !!p.bot }))
                    }
                });

                roomData.players.forEach(p => {
                    if (p.socketId) {
                        const s = io.sockets.sockets.get(p.socketId);
                        if (s) s.join(roomId);
                    }
                });

                const cleanedPlayers = roomData.players.map(p => {
                    const { tickets, completedLines, markedNumbers, ...rest } = p;
                    return rest;
                });

                io.to(roomId).emit("setupTicket", {
                    roomId,
                    cardCount: count,
                    players: cleanedPlayers
                });

                // Waiting room delete karne se pehle log karein
                waitingRooms.delete(roomKey);

                // --- NAYA LOG: Waiting Room Cleared ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: "SYSTEM",
                    event: "WAITING_ROOM_DELETED",
                    details: { roomKey: roomKey, msg: "Memory cleared, game moved to DB" }
                });

            } catch (err) {
                // --- LOG ERROR ---
                await ActionLog.create({
                    roomId: "SYSTEM_ERROR",
                    userId: "SERVER",
                    event: "CREATE_ROOM_FUNCTION_ERROR",
                    details: { error: err.message, roomKey: roomKey }
                });
                console.error("Critical Room Creation Error:", err);
            }
        }

        // socket.on("submitTicket", async ({ user_id, roomId, tickets }) => {
        //     try {
        //         if (user_id != socket.verified_id) {
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }

        //         // 1. ATOMIC UPDATE: Player ka data update karein aur updated room wapas lein
        //         // Yeh query version error nahi degi kyunki ye direct DB mein modify karti hai
        //         const updatedRoom = await Room.findOneAndUpdate(
        //             {
        //                 roomId,
        //                 "players.user_id": user_id
        //             },
        //             {
        //                 $set: {
        //                     "players.$.tickets": tickets,
        //                     "players.$.isReady": true,
        //                     "players.$.markedNumbers": tickets.map(() => []),
        //                     "players.$.completedLines": tickets.map(() => 0)
        //                 }
        //             },
        //             { new: true } // updated document wapas chahiye
        //         );

        //         if (!updatedRoom) return;

        //         // 2. Ab check karein kya saare players ready hain updatedRoom se
        //         const allReady = updatedRoom.players.every(p => p.isReady);
        //         console.log("allReady check:", allReady);

        //         if (allReady) {
        //             // Room status ko update karne ke liye ek atomic update aur
        //             const finalRoom = await Room.findOneAndUpdate(
        //                 { roomId, status: { $ne: 'playing' } }, // Avoid double activation
        //                 {
        //                     $set: {
        //                         status: 'playing',
        //                         turn: updatedRoom.players[0].user_id
        //                     }
        //                 },
        //                 { new: true }
        //             );

        //             if (finalRoom) {
        //                 // Coins deduct logic (Bulk)
        //                 const lobby = await GameWallet.findById(finalRoom.gamelobby_id);
        //                 const entryFee = lobby ? lobby.entryCoinsUsed : 0;

        //                 if (entryFee > 0) {
        //                     const realPlayerIds = finalRoom.players
        //                         .filter(p => !p.bot)
        //                         .map(p => p.user_id);

        //                     await User.updateMany(
        //                         { user_id: { $in: realPlayerIds } },
        //                         { $inc: { coins: -entryFee } }
        //                     );
        //                 }

        //                 // Game Start Events
        //                 io.to(roomId).emit("gameStarted", {
        //                     roomId: roomId,
        //                     players: finalRoom.players,
        //                     status: 'playing',
        //                     turn: finalRoom.turn,
        //                     calledNumbers: []
        //                 });

        //                 const firstPlayer = finalRoom.players[0];
        //                 if (firstPlayer.bot) {
        //                     handleBotTurn(roomId, firstPlayer.user_id, io);
        //                 } else {
        //                     startTurnTimer(roomId, firstPlayer.user_id, io);
        //                 }
        //             }
        //         } else {
        //             socket.emit("waitingForOpponent", { message: "Opponent is still filling their cards..." });
        //         }

        //     } catch (err) {
        //         console.error("Submit Error:", err);
        //     }
        // });


        socket.on("submitTicket", async ({ user_id, roomId, tickets }) => {
            try {
                if (user_id != socket.verified_id) {
                    // LOG: Unauthorized attempt
                    await ActionLog.create({
                        roomId: roomId || "N/A",
                        userId: user_id,
                        event: "UNAUTHORIZED_TICKET_SUBMIT",
                        details: { socket_verified_id: socket.verified_id }
                    });
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                const updatedRoom = await Room.findOneAndUpdate(
                    {
                        roomId,
                        "players.user_id": user_id
                    },
                    {
                        $set: {
                            "players.$.tickets": tickets,
                            "players.$.isReady": true,
                            "players.$.markedNumbers": tickets.map(() => []),
                            "players.$.completedLines": tickets.map(() => 0)
                        }
                    },
                    { new: true }
                );

                if (!updatedRoom) return;

                // --- NAYA LOG: Ticket Submitted ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: user_id,
                    event: "TICKET_SUBMITTED",
                    details: { ticketsCount: tickets.length, msg: "Player is ready" }
                });

                const allReady = updatedRoom.players.every(p => p.isReady);
                // console.log("allReady check:", allReady);

                if (allReady) {
                    const finalRoom = await Room.findOneAndUpdate(
                        { roomId, status: { $ne: 'playing' } },
                        {
                            $set: {
                                status: 'playing',
                                turn: updatedRoom.players[0].user_id
                            }
                        },
                        { new: true }
                    );

                    if (finalRoom) {
                        const lobby = await GameWallet.findById(finalRoom.gamelobby_id);
                        const entryFee = lobby ? lobby.entryCoinsUsed : 0;

                        if (entryFee > 0) {
                            const realPlayerIds = finalRoom.players
                                .filter(p => !p.bot)
                                .map(p => p.user_id);

                            await User.updateMany(
                                { user_id: { $in: realPlayerIds } },
                                { $inc: { coins: -entryFee } }
                            );

                            // --- NAYA LOG: Public Game Coins Deducted ---
                            await ActionLog.create({
                                roomId: roomId,
                                userId: "SYSTEM",
                                event: "COINS_DEDUCTED_START",
                                details: {
                                    fee: entryFee,
                                    players: realPlayerIds,
                                    msg: "Deducted from all real players"
                                }
                            });
                        }

                        // --- NAYA LOG: Game Started ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            event: "GAME_STARTED_PLAYING",
                            details: {
                                firstTurn: finalRoom.turn,
                                totalPlayers: finalRoom.players.length
                            }
                        });

                        io.to(roomId).emit("gameStarted", {
                            roomId: roomId,
                            players: finalRoom.players,
                            status: 'playing',
                            turn: finalRoom.turn,
                            calledNumbers: []
                        });

                        const firstPlayer = finalRoom.players[0];
                        if (firstPlayer.bot) {
                            handleBotTurn(roomId, firstPlayer.user_id, io);
                        } else {
                            startTurnTimer(roomId, firstPlayer.user_id, io);
                        }
                    }
                } else {
                    socket.emit("waitingForOpponent", { message: "Opponent is still filling their cards..." });
                }

            } catch (err) {
                // --- NAYA LOG: Error ---
                await ActionLog.create({
                    roomId: roomId || "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "SUBMIT_TICKET_ERROR",
                    details: { error: err.message }
                });
                console.error("Submit Error:", err);
            }
        });


        // function startTurnTimer(roomId, nextUserId, io, isPower = false,) {
        //     // console.log("room",roomId)
        //     if (turnTimeouts[roomId]) clearTimeout(turnTimeouts[roomId]);

        //     turnTimeouts[roomId] = setTimeout(async () => {
        //         try {
        //             const room = await Room.findOne({ roomId });
        //             if (!room || room.turn !== nextUserId || room.status !== 'playing') return;

        //             const playerIdx = room.players.findIndex(p => p.user_id === nextUserId);
        //             const player = room.players[playerIdx];
        //             // console.log("player",player)
        //             // 1st Time Miss: Auto-Call Number
        //             if (!player.missedTurns || player.missedTurns < 1) {
        //                 player.missedTurns = (player.missedTurns || 0) + 1;

        //                 // Bot logic use karke ek random number uthayein jo ticket mein ho
        //                 let availableNumbers = player.tickets[0].flat().filter(n => !room.calledNumbers.includes(n));
        //                 const autoNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];

        //                 console.log(`Auto-calling for ${nextUserId}`);
        //                 await processMove(room, autoNumber, nextUserId, io, isPower);
        //             }
        //             // 2nd Time Miss: Opponent Wins
        //             else {
        //                 room.status = 'finished';
        //                 // console.log("status",room.status)
        //                 // Saamne wala winner (2 players case mein index 0 ka 1, aur 1 ka 0)
        //                 const winnerIndex = (playerIdx + 1) % room.players.length;
        //                 const winner = room.players[winnerIndex];

        //                 room.winner = winner.name;
        //                 await room.save();
        //                 await Room.deleteOne({ roomId: room.roomId });

        //                 io.to(roomId).emit("gameOver", {
        //                     winner: winner.name,
        //                     user_id: winner.user_id,
        //                     reason: "Opponent missed turns twice."
        //                 });



        //                 const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });
        //                 if (!wallet) return;

        //                 // 🔹 winner coins ADD (not replace)
        //                 await User.findOneAndUpdate(
        //                     { user_id: winner.user_id },
        //                     {
        //                         $inc: {
        //                             coins: wallet.coinsWon, // ex: 400
        //                             diamonds: wallet.diamondsWon
        //                         }
        //                     },
        //                     { new: true }
        //                 );
        //             }
        //         } catch (e) { console.error("Timer Error:", e); }
        //     }, 30000);
        // }


        function startTurnTimer(roomId, nextUserId, io, isPower = false) {
            // console.log("room",roomId)
            if (turnTimeouts[roomId]) clearTimeout(turnTimeouts[roomId]);

            turnTimeouts[roomId] = setTimeout(async () => {
                try {
                    const room = await Room.findOne({ roomId });
                    if (!room || room.turn !== nextUserId || room.status !== 'playing') return;

                    const playerIdx = room.players.findIndex(p => p.user_id === nextUserId);
                    const player = room.players[playerIdx];

                    // 1st Time Miss: Auto-Call Number
                    if (!player.missedTurns || player.missedTurns < 1) {
                        player.missedTurns = (player.missedTurns || 0) + 1;

                        let availableNumbers = player.tickets[0].flat().filter(n => !room.calledNumbers.includes(n));
                        const autoNumber = availableNumbers[Math.floor(Math.random() * availableNumbers.length)];

                        // --- NAYA LOG: Auto-Move Execution ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: nextUserId,
                            userName: player.name,
                            event: "AUTO_MOVE_EXECUTED",
                            details: {
                                missedCount: player.missedTurns,
                                autoNumber: autoNumber,
                                msg: "Player timeout, system played for them"
                            }
                        });

                        // console.log(`Auto-calling for ${nextUserId}`);
                        await processMove(room, autoNumber, nextUserId, io, isPower);
                    }
                    // 2nd Time Miss: Opponent Wins
                    else {
                        room.status = 'finished';
                        const winnerIndex = (playerIdx + 1) % room.players.length;
                        const winner = room.players[winnerIndex];

                        room.winner = winner.name;

                        // --- NAYA LOG: Game Over via Timeout ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: "SYSTEM",
                            event: "GAME_OVER_TIMEOUT",
                            details: {
                                loser_id: nextUserId,
                                winner_id: winner.user_id,
                                reason: "Opponent missed turns twice"
                            }
                        });

                        await room.save();
                        await Room.deleteOne({ roomId: room.roomId });

                        io.to(roomId).emit("gameOver", {
                            winner: winner.name,
                            user_id: winner.user_id,
                            reason: "Opponent missed turns twice."
                        });

                        const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });
                        if (wallet) {
                            // 🔹 winner coins ADD
                            await User.findOneAndUpdate(
                                { user_id: winner.user_id },
                                {
                                    $inc: {
                                        coins: wallet.coinsWon,
                                        diamonds: wallet.diamondsWon
                                    }
                                },
                                { new: true }
                            );

                            // --- NAYA LOG: Reward Added ---
                            await ActionLog.create({
                                roomId: roomId,
                                userId: winner.user_id,
                                event: "TIMEOUT_REWARD_SUCCESS",
                                details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                            });
                        }
                    }
                } catch (e) {
                    // --- LOG ERROR ---
                    await ActionLog.create({
                        roomId: roomId || "SYSTEM",
                        userId: "SERVER",
                        event: "TURN_TIMER_ERROR",
                        details: { error: e.message }
                    });
                    console.error("Timer Error:", e);
                }
            }, 30000);
        }

        // async function processMove(room, number, user_id, io, isPower = false) {
        //     const roomId = room.roomId;
        //     const currentIndex = room.players.findIndex(p => p.user_id === user_id);
        //     const currentPlayer = room.players[currentIndex];

        //     // 1. Numbers add aur progress check
        //     if (!room.calledNumbers.includes(number)) {
        //         room.calledNumbers.push(number);
        //     }

        //     // 2. Logic for Power and Turn Management
        //     let shouldChangeTurn = true;

        //     if (isPower && !currentPlayer.hasUsedPower) {
        //         // Agar player ne power button dabaya hai aur uske paas power bachi hai
        //         if (currentPlayer.powerTurnCount === 0) {
        //             currentPlayer.powerTurnCount = 1; // Pehla turn count karo
        //             currentPlayer.hasUsedPower = true,
        //                 shouldChangeTurn = false;         // Turn change NAHI hoga
        //         }
        //     } else if (currentPlayer.powerTurnCount === 1) {
        //         // Player apna extra turn chal chuka hai
        //         currentPlayer.powerTurnCount = 0;
        //         currentPlayer.hasUsedPower = true;    // AB power permanently khatam
        //         shouldChangeTurn = true;


        //         const updatedUser = await User.findOneAndUpdate({
        //             user_id, power: { $gt: 0 }
        //         }, { $inc: { power: -1 } }, { new: true });

        //         // Ab turn change hoga
        //     } else {
        //         // Normal move logic
        //         shouldChangeTurn = true;
        //     }

        //     // 3. Sabhi players ka updated data (including power status) taiyar karein
        //     const playersProgress = room.players.map(player => {
        //         // Har ticket ke liye bingo lines check karein
        //         player.tickets.forEach((ticket, tIdx) => {
        //             player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
        //         });

        //         return {
        //             user_id: player.user_id,
        //             completedLines: player.completedLines,
        //             hasUsedPower: player.hasUsedPower, // Frontend ko batane ke liye ki button hide/disable karna hai
        //             powerTurnCount: player.powerTurnCount // Debugging ya UI ke liye
        //         };
        //     });

        //     // 4. Turn change management
        //     if (shouldChangeTurn) {
        //         const nextIndex = (currentIndex + 1) % room.players.length;
        //         room.turn = room.players[nextIndex].user_id;
        //     } else {
        //         room.turn = currentPlayer.user_id; // Turn wapas usi ko do
        //     }

        //     await room.save();

        //     // 5. Frontend ko data bhejein
        //     io.to(roomId).emit("numberCalled", {
        //         number: number,
        //         turn: room.turn,
        //         players: playersProgress, // Isme ab hasUsedPower property ja rahi hai
        //     });

        //     // 6. Next Turn Timer/Bot logic
        //     const activePlayer = room.players.find(p => p.user_id === room.turn);
        //     if (activePlayer.bot) {
        //         handleBotTurn(roomId, activePlayer.user_id, io);
        //     } else {
        //         // Note: startTurnTimer mein check karein ki wo turn skip na kar de
        //         startTurnTimer(roomId, activePlayer.user_id, io, isPower);
        //     }
        // }


        async function processMove(room, number, user_id, io, isPower = false) {
            try {
                const roomId = room.roomId;
                const currentIndex = room.players.findIndex(p => p.user_id === user_id);
                const currentPlayer = room.players[currentIndex];

                // 1. Numbers add aur progress check
                if (!room.calledNumbers.includes(number)) {
                    room.calledNumbers.push(number);
                }

                // --- NAYA LOG: Move Received ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: user_id,
                    userName: currentPlayer.name,
                    event: "MOVE_PROCESSED",
                    details: {
                        calledNumber: number,
                        isPowerUsed: isPower,
                        currentTurnCount: currentPlayer.powerTurnCount
                    }
                });

                // 2. Logic for Power and Turn Management
                let shouldChangeTurn = true;

                if (isPower && !currentPlayer.hasUsedPower) {
                    if (currentPlayer.powerTurnCount === 0) {
                        currentPlayer.powerTurnCount = 1;
                        currentPlayer.hasUsedPower = true;
                        shouldChangeTurn = false;

                        // --- NAYA LOG: Power Activated ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            event: "POWER_ACTIVATED",
                            details: { msg: "Extra turn granted, turn will not change" }
                        });
                    }
                } else if (currentPlayer.powerTurnCount === 1) {
                    currentPlayer.powerTurnCount = 0;
                    currentPlayer.hasUsedPower = true;
                    shouldChangeTurn = true;

                    const updatedUser = await User.findOneAndUpdate({
                        user_id, power: { $gt: 0 }
                    }, { $inc: { power: -1 } }, { new: true });

                    // --- NAYA LOG: Power Expired & Deducted ---
                    await ActionLog.create({
                        roomId: roomId,
                        userId: user_id,
                        event: "POWER_DEDUCTED_DB",
                        details: { remainingPower: updatedUser ? updatedUser.power : 0 }
                    });

                } else {
                    shouldChangeTurn = true;
                }

                // 3. Players progress check
                const playersProgress = room.players.map(player => {
                    player.tickets.forEach((ticket, tIdx) => {
                        player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
                    });

                    return {
                        user_id: player.user_id,
                        completedLines: player.completedLines,
                        hasUsedPower: player.hasUsedPower,
                        powerTurnCount: player.powerTurnCount
                    };
                });

                // 4. Turn change management
                const previousTurn = room.turn;
                if (shouldChangeTurn) {
                    const nextIndex = (currentIndex + 1) % room.players.length;
                    room.turn = room.players[nextIndex].user_id;
                } else {
                    room.turn = currentPlayer.user_id;
                }

                // --- NAYA LOG: Turn Update ---
                if (previousTurn !== room.turn) {
                    await ActionLog.create({
                        roomId: roomId,
                        userId: "SYSTEM",
                        event: "TURN_CHANGED",
                        details: { from: previousTurn, to: room.turn }
                    });
                }

                await room.save();

                // 5. Frontend ko data bhejein
                io.to(roomId).emit("numberCalled", {
                    number: number,
                    turn: room.turn,
                    players: playersProgress,
                });

                // 6. Next Turn Timer/Bot logic
                const activePlayer = room.players.find(p => p.user_id === room.turn);
                if (activePlayer.bot) {
                    handleBotTurn(roomId, activePlayer.user_id, io);
                } else {
                    startTurnTimer(roomId, activePlayer.user_id, io, isPower);
                }

            } catch (err) {
                await ActionLog.create({
                    roomId: room.roomId || "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "PROCESS_MOVE_ERROR",
                    details: { error: err.message }
                });
                console.error("Process Move Error:", err);
            }
        }


        // const handleBotTurn = async (roomId, botUserId, io) => {
        //     const delay = Math.floor(Math.random() * 3000) + 2000; // 2 to 5 seconds delay

        //     setTimeout(async () => {
        //         try {
        //             const room = await Room.findOne({ roomId });
        //             if (!room || room.status !== 'playing' || room.turn !== botUserId) return;

        //             const botPlayer = room.players.find(p => p.user_id === botUserId);
        //             const chosenNumber = getBotDecision(botPlayer, room);

        //             if (chosenNumber) {
        //                 room.calledNumbers.push(chosenNumber);

        //                 // Line Update Logic
        //                 room.players.forEach(player => {
        //                     player.tickets.forEach((ticket, tIdx) => {
        //                         player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
        //                     });
        //                 });

        //                 const playersProgress = room.players.map(player => {
        //                     player.tickets.forEach((ticket, tIdx) => {
        //                         player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
        //                     });

        //                     // Sirf id aur completedLines return kar rahe hain
        //                     return {
        //                         user_id: player.user_id,
        //                         completedLines: player.completedLines
        //                     };
        //                 });

        //                 const currentIndex = room.players.findIndex(p => p.user_id === botUserId);
        //                 const nextPlayer = room.players[(currentIndex + 1) % room.players.length];
        //                 room.turn = nextPlayer.user_id;

        //                 await room.save();

        //                 io.to(roomId).emit("numberCalled", { number: chosenNumber, turn: room.turn, players: playersProgress });

        //                 if (nextPlayer.bot) {
        //                     handleBotTurn(roomId, nextPlayer.user_id, io);
        //                 } else {
        //                     startTurnTimer(roomId, nextPlayer.user_id, io);
        //                 }
        //             }
        //         } catch (err) { console.error("Bot Turn Error:", err); }
        //     }, delay);
        // };


        const handleBotTurn = async (roomId, botUserId, io) => {
            const delay = Math.floor(Math.random() * 3000) + 2000; // 2 to 5 seconds delay

            setTimeout(async () => {
                try {
                    const room = await Room.findOne({ roomId });
                    if (!room || room.status !== 'playing' || room.turn !== botUserId) return;

                    const botPlayer = room.players.find(p => p.user_id === botUserId);
                    const chosenNumber = getBotDecision(botPlayer, room);

                    if (chosenNumber) {
                        // --- NAYA LOG: Bot Decision ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: botUserId,
                            userName: botPlayer.name,
                            event: "BOT_MOVE_EXECUTED",
                            details: {
                                chosenNumber: chosenNumber,
                                delayApplied: delay,
                                msg: "Bot played its turn automatically"
                            }
                        });

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
                            return {
                                user_id: player.user_id,
                                completedLines: player.completedLines
                            };
                        });

                        const currentIndex = room.players.findIndex(p => p.user_id === botUserId);
                        const nextPlayer = room.players[(currentIndex + 1) % room.players.length];
                        room.turn = nextPlayer.user_id;

                        await room.save();

                        // --- NAYA LOG: Bot Turn Finished ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: "SYSTEM",
                            event: "BOT_TURN_FINISHED",
                            details: { nextTurn: room.turn, isNextBot: !!nextPlayer.bot }
                        });

                        io.to(roomId).emit("numberCalled", { number: chosenNumber, turn: room.turn, players: playersProgress });

                        if (nextPlayer.bot) {
                            handleBotTurn(roomId, nextPlayer.user_id, io);
                        } else {
                            startTurnTimer(roomId, nextPlayer.user_id, io);
                        }
                    }
                } catch (err) {
                    // --- NAYA LOG: Bot Error ---
                    await ActionLog.create({
                        roomId: roomId || "SYSTEM",
                        userId: botUserId || "BOT",
                        event: "BOT_TURN_ERROR",
                        details: { error: err.message }
                    });
                    console.error("Bot Turn Error:", err);
                }
            }, delay);
        };


        // socket.on("userpowercheck", async ({ roomId, user_id }) => {
        //     try {

        //         if (user_id != socket.verified_id) {
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }
        //         const room = await Room.findOne({ roomId });

        //         if (!room) {
        //             return socket.emit("userpowercheck", {
        //                 canUsePower: false,
        //                 message: "Room not found"
        //             });
        //         }

        //         // 1. Room ke players mein se current user ko dhoondhen
        //         const player = room.players.find(p => p.user_id === user_id);

        //         if (!player) {
        //             return socket.emit("userpowercheck", {
        //                 canUsePower: false,
        //                 message: "Player not found"
        //             });
        //         }

        //         // 2. Conditions check karein:
        //         // - Kya uski turn hai?
        //         // - Kya usne pehle power use kar li hai?
        //         // - Kya game abhi chal raha hai?
        //         const isHisTurn = room.turn === user_id;
        //         const alreadyUsed = player.hasUsedPower;
        //         const isPlaying = room.status === 'playing';

        //         let canUse = false;
        //         let msg = "";

        //         if (!isPlaying) {
        //             msg = "Game is not active.";
        //         } else if (!isHisTurn) {
        //             msg = "Wait for your turn.";
        //         } else if (alreadyUsed) {
        //             msg = "You have already used your power once!";
        //         } else {
        //             canUse = true;
        //             msg = "Power available!";
        //         }

        //         // 3. Response bhejein
        //         socket.emit("userpowercheck", {
        //             canUsePower: canUse,
        //             message: msg
        //         });

        //     } catch (err) {
        //         console.error("Power Check Error:", err);
        //         socket.emit("userpowercheck", { canUsePower: false, message: "Server error" });
        //     }
        // });


        socket.on("userpowercheck", async ({ roomId, user_id }) => {
            try {
                if (user_id != socket.verified_id) {
                    // --- NAYA LOG: Unauthorized Power Check ---
                    await ActionLog.create({
                        roomId: roomId || "N/A",
                        userId: user_id,
                        event: "UNAUTHORIZED_POWER_CHECK",
                        details: { socket_verified_id: socket.verified_id }
                    });
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                const room = await Room.findOne({ roomId });

                if (!room) {
                    return socket.emit("userpowercheck", {
                        canUsePower: false,
                        message: "Room not found"
                    });
                }

                const player = room.players.find(p => p.user_id === user_id);

                if (!player) {
                    return socket.emit("userpowercheck", {
                        canUsePower: false,
                        message: "Player not found"
                    });
                }

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

                // --- NAYA LOG: Power Request Result ---
                // Hum sirf tab log kar rahe hain jab result 'False' ho (denied) 
                // ya phir jab use 'True' (Success) mile, taaki audit trial rahe.
                await ActionLog.create({
                    roomId: roomId,
                    userId: user_id,
                    userName: player.name,
                    event: canUse ? "POWER_CHECK_SUCCESS" : "POWER_CHECK_DENIED",
                    details: {
                        allowed: canUse,
                        reason: msg,
                        roomStatus: room.status,
                        isTurn: isHisTurn,
                        alreadyUsed: alreadyUsed
                    }
                });

                socket.emit("userpowercheck", {
                    canUsePower: canUse,
                    message: msg
                });

            } catch (err) {
                // --- NAYA LOG: Error ---
                await ActionLog.create({
                    roomId: roomId || "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "POWER_CHECK_ERROR",
                    details: { error: err.message }
                });
                console.error("Power Check Error:", err);
                socket.emit("userpowercheck", { canUsePower: false, message: "Server error" });
            }
        });

        // socket.on("callNumber", async ({ roomId, number, user_id, isPower }) => { // isPower flag add kiya
        //     try {
        //         if (user_id != socket.verified_id) {
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }


        //         if (turnTimeouts[roomId]) {
        //             clearTimeout(turnTimeouts[roomId]);
        //             delete turnTimeouts[roomId];
        //         }

        //         const room = await Room.findOne({ roomId });
        //         if (!room || room.turn !== user_id || room.status !== 'playing') return;

        //         const currentPlayer = room.players.find(p => p.user_id === user_id);
        //         if (currentPlayer) currentPlayer.missedTurns = 0;

        //         // Pass isPower to processMove
        //         await processMove(room, number, user_id, io, isPower);

        //     } catch (err) { console.error(err); }
        // });




        socket.on("callNumber", async ({ roomId, number, user_id, isPower }) => { // isPower flag add kiya
            try {
                if (user_id != socket.verified_id) {
                    // --- NAYA LOG: Unauthorized Manual Call ---
                    await ActionLog.create({
                        roomId: roomId || "N/A",
                        userId: user_id,
                        event: "UNAUTHORIZED_CALL_ATTEMPT",
                        details: { socket_verified_id: socket.verified_id, numberCalled: number }
                    });
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                if (turnTimeouts[roomId]) {
                    clearTimeout(turnTimeouts[roomId]);
                    delete turnTimeouts[roomId];

                    // --- NAYA LOG: Timer Cleared ---
                    // Isse pata chalega ki player ne system ke auto-call se pehle move kar liya
                    await ActionLog.create({
                        roomId: roomId,
                        userId: user_id,
                        event: "TURN_TIMER_CLEARED",
                        details: { msg: "Player moved in time, timeout deleted" }
                    });
                }

                const room = await Room.findOne({ roomId });

                // Agar room nahi milta ya player ki turn nahi hai
                if (!room || room.turn !== user_id || room.status !== 'playing') {
                    await ActionLog.create({
                        roomId: roomId,
                        userId: user_id,
                        event: "CALL_REJECTED",
                        details: {
                            reason: !room ? "Room not found" : (room.turn !== user_id ? "Not user's turn" : "Game not playing"),
                            expectedTurn: room ? room.turn : "N/A"
                        }
                    });
                    return;
                }

                const currentPlayer = room.players.find(p => p.user_id === user_id);

                if (currentPlayer) {
                    // Missed turns reset karne ka log
                    if (currentPlayer.missedTurns > 0) {
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            event: "MISSED_TURNS_RESET",
                            details: { previousMissed: currentPlayer.missedTurns }
                        });
                    }
                    currentPlayer.missedTurns = 0;
                }

                // --- NAYA LOG: Manual Number Call ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: user_id,
                    userName: currentPlayer ? currentPlayer.name : "Unknown",
                    event: "MANUAL_NUMBER_CALLED",
                    details: { number: number, isPower: !!isPower }
                });

                // Pass isPower to processMove
                await processMove(room, number, user_id, io, isPower);

            } catch (err) {
                // --- NAYA LOG: Error ---
                await ActionLog.create({
                    roomId: roomId || "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "CALL_NUMBER_ERROR",
                    details: { error: err.message }
                });
                console.error(err);
            }
        });
        // socket.on("claimBingo", async ({ roomId, user_id }) => {
        //     try {

        //         if (user_id != socket.verified_id) {
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }
        //         const room = await Room.findOne({ roomId });
        //         if (!room || room.status !== 'playing') return;

        //         const player = room.players.find(p => p.user_id === user_id);
        //         if (player && player.completedLines.some(l => l >= 5)) {
        //             room.status = 'finished';
        //             room.winner = player.name;
        //             await room.save();
        //             io.to(roomId).emit("gameOver", { winner: player.name, user_id: player.user_id });
        //             await Room.deleteOne({ roomId: room.roomId });
        //             const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

        //             // console.log("wallet",wallet)
        //             if (!wallet) return;

        //             // 🔹 winner coins ADD (not replace)
        //             await User.findOneAndUpdate(
        //                 { user_id: player.user_id },
        //                 {
        //                     $inc: {
        //                         coins: wallet.coinsWon, // ex: 400
        //                         diamonds: wallet.diamondsWon
        //                     }
        //                 },
        //                 { new: true }
        //             );

        //         }
        //     } catch (err) { console.error(err); }
        // });


        socket.on("claimBingo", async ({ roomId, user_id }) => {
            try {
                if (user_id != socket.verified_id) {
                    // --- NAYA LOG: Unauthorized Claim ---
                    await ActionLog.create({
                        roomId: roomId || "N/A",
                        userId: user_id,
                        event: "UNAUTHORIZED_CLAIM_ATTEMPT",
                        details: { socket_verified_id: socket.verified_id }
                    });
                    return socket.emit("error", { message: "Unauthorized!" });
                }

                const room = await Room.findOne({ roomId });

                if (!room || room.status !== 'playing') {
                    // --- NAYA LOG: Invalid Claim Attempt ---
                    await ActionLog.create({
                        roomId: roomId,
                        userId: user_id,
                        event: "INVALID_CLAIM_ATTEMPT",
                        details: { reason: !room ? "Room not found" : "Game already finished/not active" }
                    });
                    return;
                }

                const player = room.players.find(p => p.user_id === user_id);

                // --- BINGO VALIDATION & REWARDS ---
                if (player && player.completedLines.some(l => l >= 5)) {

                    // --- NAYA LOG: Bingo Validated ---
                    await ActionLog.create({
                        roomId: roomId,
                        userId: user_id,
                        userName: player.name,
                        event: "BINGO_CLAIMED_SUCCESS",
                        details: { completedLines: player.completedLines, msg: "Player reached 5 lines" }
                    });

                    room.status = 'finished';
                    room.winner = player.name;
                    await room.save();

                    io.to(roomId).emit("gameOver", { winner: player.name, user_id: player.user_id });

                    const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                    if (wallet) {
                        // 🔹 winner coins ADD
                        const updatedWinner = await User.findOneAndUpdate(
                            { user_id: player.user_id },
                            {
                                $inc: {
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon
                                }
                            },
                            { new: true }
                        );

                        // --- NAYA LOG: Winner Reward Credited ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: player.user_id,
                            event: "GAME_WIN_REWARD_CREDITED",
                            details: {
                                coinsWon: wallet.coinsWon,
                                diamondsWon: wallet.diamondsWon,
                                newBalance: updatedWinner ? updatedWinner.coins : "N/A"
                            }
                        });
                    } else {
                        // --- NAYA LOG: Wallet Missing ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: "SYSTEM",
                            event: "WIN_REWARD_ERROR",
                            details: { msg: "GameWallet not found for reward distribution", lobby_id: room.gamelobby_id }
                        });
                    }

                    // Room delete tabhi karein jab rewards process ho jayein
                    await Room.deleteOne({ roomId: room.roomId });

                    // --- NAYA LOG: Room Deleted ---
                    await ActionLog.create({
                        roomId: roomId,
                        userId: "SYSTEM",
                        event: "GAME_ROOM_CLEANED",
                        details: { msg: "Game finished and room removed from DB" }
                    });

                } else {
                    // --- NAYA LOG: False Bingo Claim ---
                    await ActionLog.create({
                        roomId: roomId,
                        userId: user_id,
                        event: "FALSE_BINGO_CLAIM",
                        details: { completedLines: player ? player.completedLines : "No Player" }
                    });
                }
            } catch (err) {
                // --- NAYA LOG: Catch Block ---
                await ActionLog.create({
                    roomId: roomId || "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "CLAIM_BINGO_ERROR",
                    details: { error: err.message }
                });
                console.error(err);
            }
        });
    });

};