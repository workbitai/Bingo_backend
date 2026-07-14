const Room = require("../Models/BingoRoom");
const User = require("../Models/Users");
const GameWallet = require("../Models/GameWallet");
const RandomUser = require("../Models/RandomUser");
const ActionLog = require("../Models/Log");
// const QRCode = require('qrcode');
const jwt = require("jsonwebtoken");

require("dotenv").config();

const BASE_URL = process.env.BASE_URL;

const waitingRooms = new Map();

module.exports = (io) => {



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

    // const checkBingoLines = (ticket, calledNumbers) => {
    //     let lines = 0;
    //     ticket.forEach(row => { if (row.every(num => calledNumbers.includes(num))) lines++; });
    //     for (let i = 0; i < 5; i++) {
    //         const col = [ticket[0][i], ticket[1][i], ticket[2][i], ticket[3][i], ticket[4][i]];
    //         if (col.every(num => calledNumbers.includes(num))) lines++;
    //     }
    //     const d1 = [ticket[0][0], ticket[1][1], ticket[2][2], ticket[3][3], ticket[4][4]];
    //     const d2 = [ticket[0][4], ticket[1][3], ticket[2][2], ticket[3][1], ticket[4][0]];
    //     if (d1.every(num => calledNumbers.includes(num))) lines++;
    //     if (d2.every(num => calledNumbers.includes(num))) lines++;
    //     return lines;
    // };
    // 1. Bot ki ticket random numbers (1-25) se generate karne ke liye

    function checkBingoLines(ticket, calledNumbers) {
        let allCompletedLines = []; // Isme har line ek alag array ban kar jayegi

        // 1. Check Rows (5 Horizontal Lines)
        for (let i = 0; i < 5; i++) {
            let row = ticket[i]; // Maan kar chal rahe hain ticket[i] ek array hai [n, n, n, n, n]
            if (row.every(num => calledNumbers.includes(num) || num === 0)) {
                allCompletedLines.push(row);
            }
        }

        // 2. Check Columns (5 Vertical Lines)
        for (let i = 0; i < 5; i++) {
            let col = [ticket[0][i], ticket[1][i], ticket[2][i], ticket[3][i], ticket[4][i]];
            if (col.every(num => calledNumbers.includes(num) || num === 0)) {
                allCompletedLines.push(col);
            }
        }

        // 3. Check Diagonals (2 Diagonal Lines)
        const d1 = [ticket[0][0], ticket[1][1], ticket[2][2], ticket[3][3], ticket[4][4]];
        const d2 = [ticket[0][4], ticket[1][3], ticket[2][2], ticket[3][1], ticket[4][0]];

        if (d1.every(num => calledNumbers.includes(num) || num === 0)) {
            allCompletedLines.push(d1);
        }
        if (d2.every(num => calledNumbers.includes(num) || num === 0)) {
            allCompletedLines.push(d2);
        }

        // Return Array of Arrays: [[L1], [L2]...]
        return allCompletedLines;
    }
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




    io.on("connection", (socket) => {
        console.log("socket connected", socket.id);

        socket.on("disconnect", async () => {
            try {
                console.log("socket disconnect")
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

                    const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                    io.to(roomId).emit("gameOver", {
                        winner: currentRoom.winner,
                        user_id: winner ? winner.user_id : null,
                        coins: wallet?.coinsWon,
                        diamonds: wallet?.diamondsWon,
                        players: room.players,
                        reason: "Opponent failed to rejoin within 1 minute."
                    });

                    // Wallet & Coins Update

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


        socket.on("createPrivateRoom", async ({ user_id, cardCount, gamelobby_id, verify_token }) => {
            try {
                // console.log("createPrivateRoom user_id")
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


                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check
                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });

                        // 2. Room aur Players ka data nikalein
                        const activeRoom = await Room.findOne({
                            "players.user_id": user_id,
                            status: { $in: ['setup', 'playing'] }
                        });
                        if (!activeRoom) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (activeRoom.status === 'finished') return;

                        const quitter = activeRoom.players.find(p => p.user_id === user_id);
                        const winner = activeRoom.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: activeRoom.roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: activeRoom.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: activeRoom.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: activeRoom.roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        activeRoom.status = 'finished';
                        activeRoom.winner = winner ? winner.name : "None";
                        await activeRoom.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: activeRoom.roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(activeRoom.roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[activeRoom.roomId]) {
                            clearTimeout(turnTimeouts[activeRoom.roomId]);
                            delete turnTimeouts[activeRoom.roomId];
                        }
                        return

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: activeRoom.roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
                }
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
                    maxPlayers: 2,
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



        socket.on("joinPrivateRoom", async ({ user_id, joinKey, verify_token }) => {
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
                const user = await User.findOne({ user_id }).lean();
                if (!user) return;
                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check
                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });

                        // 2. Room aur Players ka data nikalein
                        const activeRoom = await Room.findOne({
                            "players.user_id": user_id,
                            status: { $in: ['setup', 'playing'] }
                        });
                        if (!activeRoom) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (activeRoom.status === 'finished') return;

                        const quitter = activeRoom.players.find(p => p.user_id === user_id);
                        const winner = activeRoom.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: activeRoom.roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: activeRoom.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: activeRoom.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: activeRoom.roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        activeRoom.status = 'finished';
                        activeRoom.winner = winner ? winner.name : "None";
                        await activeRoom.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: activeRoom.roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(activeRoom.roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[activeRoom.roomId]) {
                            clearTimeout(turnTimeouts[activeRoom.roomId]);
                            delete turnTimeouts[activeRoom.roomId];
                        }
                        return

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: activeRoom.roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
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
                            coins: 0,
                            diamonds: 0,
                            players: room.players,
                            reason: "Opponent failed to rejoin within 1 minute or game ended."
                        });
                    }
                } else {
                    // NEW JOIN LOGIC
                    if (room.players.length >= 2) {
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
                    io.to(room?.roomId).emit("joinPrivateRoom", {
                        joinKey: room.joinKey,
                        joinUrl: room.joinUrl,
                        roomId: room.roomId,
                        players: room.players,
                        totalPlayer: room.players.length,
                        adminId: room.adminId
                    });

                    setTimeout(() => {

                        io.to(room?.roomId).emit("setupTicket", { roomId: room?.roomId, cardCount: room?.cardCount });
                    }, 2000);
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


        // socket.on("startPrivateGame", async ({ roomId, user_id ,verify_token}) => {
        //     try {
        //         console.log("startPrivateGame user_id", user_id)
        //         if (user_id != socket.verified_id) {
        //             // --- NAYA LOG: Unauthorized Start Attempt ---
        //             await ActionLog.create({
        //                 roomId: roomId || "N/A",
        //                 userId: user_id,
        //                 event: "UNAUTHORIZED_START_ATTEMPT",
        //                 details: { socket_verified_id: socket.verified_id, msg: "Not the verified socket user" }
        //             });
        //             return socket.emit("error", { message: "Unauthorized!" });
        //         }

        //         const room = await Room.findOne({ roomId });

        //         if (!room || room.adminId.toString() !== user_id.toString()) {
        //             // --- NAYA LOG: Not Admin or Room Missing ---
        //             await ActionLog.create({
        //                 roomId: roomId,
        //                 userId: user_id,
        //                 event: "START_GAME_DENIED",
        //                 details: { reason: !room ? "Room not found" : "User is not Admin" }
        //             });
        //             return;
        //         }

        //         if (room.players.length < 2) {
        //             return socket.emit("error", { message: "Min 2 players required!" });
        //         }

        //         const gameWallet = await GameWallet.findOne({
        //             _id: room.gamelobby_id
        //         }).lean();

        //         if (!gameWallet) {
        //             return socket.emit("error", { message: "Game wallet not found" });
        //         }

        //         const entryCoins = gameWallet.entryCoinsUsed;
        //         const userIds = room.players.map(p => p.user_id);

        //         // 🔥 IMPORTANT: Coins minus (ATOMIC, SAFE)
        //         const result = await User.updateMany(
        //             {
        //                 user_id: { $in: userIds },
        //                 coins: { $gte: entryCoins }
        //             },
        //             {
        //                 $inc: { coins: -entryCoins }
        //             }
        //         );

        //         // ❌ Agar koi user ke paas coins kam ho
        //         if (result.modifiedCount !== userIds.length) {
        //             // --- NAYA LOG: Insufficient Coins Error ---
        //             await ActionLog.create({
        //                 roomId: roomId,
        //                 userId: user_id,
        //                 event: "COIN_DEDUCTION_FAILED",
        //                 details: {
        //                     expected: userIds.length,
        //                     actual: result.modifiedCount,
        //                     entryFee: entryCoins
        //                 }
        //             });

        //             return socket.emit("error", {
        //                 message: "One or more players have insufficient coins"
        //             });
        //         }

        //         // --- NAYA LOG: Successful Coin Deduction ---
        //         await ActionLog.create({
        //             roomId: roomId,
        //             userId: "SYSTEM",
        //             event: "GAME_COINS_DEDUCTED",
        //             details: {
        //                 playerIds: userIds,
        //                 totalDeductedPerUser: entryCoins
        //             }
        //         });

        //         room.status = 'setup';
        //         await room.save();

        //         // --- NAYA LOG: Game Status Changed to Setup ---
        //         await ActionLog.create({
        //             roomId: roomId,
        //             userId: user_id,
        //             event: "PRIVATE_GAME_STARTED",
        //             details: { status: "setup", cardCount: room.cardCount }
        //         });

        //         io.to(roomId).emit("setupTicket", { roomId, cardCount: room.cardCount });

        //     } catch (err) {
        //         // --- NAYA LOG: Catch block error ---
        //         await ActionLog.create({
        //             roomId: roomId || "SYSTEM",
        //             userId: user_id || "UNKNOWN",
        //             event: "START_GAME_ERROR",
        //             details: { error: err.message }
        //         });
        //         console.error(err);
        //     }
        // });



        socket.on("joinGame", async ({ user_id, maxPlayers, cardCount, gamelobby_id, verify_token }) => {
            try {
                // console.log("joinGame user_id", user_id)
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


                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check
                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });

                        // 2. Room aur Players ka data nikalein
                        const activeRoom = await Room.findOne({
                            "players.user_id": user_id,
                            status: { $in: ['setup', 'playing'] }
                        });
                        if (!activeRoom) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (activeRoom.status === 'finished') return;

                        const quitter = activeRoom.players.find(p => p.user_id === user_id);
                        const winner = activeRoom.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: activeRoom.roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: activeRoom.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: activeRoom.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: activeRoom.roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        activeRoom.status = 'finished';
                        activeRoom.winner = winner ? winner.name : "None";
                        await activeRoom.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: activeRoom.roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(activeRoom.roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[activeRoom.roomId]) {
                            clearTimeout(turnTimeouts[activeRoom.roomId]);
                            delete turnTimeouts[activeRoom.roomId];
                        }
                        return

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: activeRoom.roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
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

                // const user = await User.findOne({ user_id }).lean();
                // if (!user) return socket.emit("error", { message: "User not found" });

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
                                    avatar: botDoc.avatar ? botDoc.avatar : -1 ,
                                    tickets: generateBotTicket(),
                                    isReady: true,
                                    bot: true,
                                      profile_pic: botDoc.profile_pic
                                        ? `http://192.168.1.45:9000${botDoc.profile_pic}`
                                        : null,
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
                      profile_pic: user.profile_pic
                                        ? `${user.profile_pic}`
                                        : null,
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
                    socket.emit("waiting", { currentPlayers: roomData.players.length, maxPlayers: playersNeeded });
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
                        const s = io.sockets.get(p.socketId);
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


        socket.on("submitTicket", async ({ user_id, roomId, tickets, verify_token }) => {
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

                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check

                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });
                        // 2. Room aur Players ka data nikalein
                        const room = await Room.findOne({ roomId });
                        if (!room) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (room.status === 'finished') return;

                        const quitter = room.players.find(p => p.user_id === user_id);
                        const winner = room.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: room.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        room.status = 'finished';
                        room.winner = winner ? winner.name : "None";
                        await room.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[roomId]) {
                            clearTimeout(turnTimeouts[roomId]);
                            delete turnTimeouts[roomId];
                        }
                        return;

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
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
                    if (!player.missedTurns || player.missedTurns < 2) {
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

                        const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                        // 1. Pehle Winner ko message bhejte hain
                        io.to(winner.socketId).emit("gameOver", {
                            winner: winner.name,
                            user_id: winner.user_id,
                            coins: wallet.coinsWon,
                            diamonds: wallet.diamondsWon,
                            players: room.players,
                            reason: "Opponent missed turns 3 times."
                        });

                        // 2. Ab Loser (jisne turns miss kiye) ko message bhejte hain
                        // Hum room ke players mein se loser ko find karenge
                        const loser = room.players.find(p => p.user_id !== winner.user_id);

                        if (loser) {
                            io.to(loser.socketId).emit("gameOver", {
                                winner: winner.name,
                                user_id: winner.user_id, // Aapki requirement ke mutabiq
                                coins: 0,
                                diamonds: 0,
                                players: room.players,
                                reason: "You missed turns 3 times. Game Over!"
                            });
                        }


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
        async function processMove(room, number, user_id, io, isPower = false, verify_token) {
            try {
                const roomId = room.roomId;
                const currentIndex = room.players.findIndex(p => p.user_id === user_id);
                const currentPlayer = room.players[currentIndex];

                // 1. Numbers add aur progress check
                if (!room.calledNumbers.includes(number)) {
                    room.calledNumbers.push(number);
                }

                if (!currentPlayer.calledNumbers.includes(number)) {
                    currentPlayer.calledNumbers.push(number);
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
                        // Yahan hum count ki jagah array of numbers le rahe hain
                        const wonNums = checkBingoLines(ticket, room.calledNumbers);
                        // console.log("wonNums", wonNums)
                        player.completedLines[tIdx] = wonNums;
                        // player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
                    });

                    return {
                        user_id: player.user_id,
                        completedLines: player.completedLines,
                        hasUsedPower: player.hasUsedPower,
                        powerTurnCount: player.powerTurnCount,
                        missedTurns: player.missedTurns
                    };
                });
                room.markModified('players');
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
                        botPlayer.calledNumbers.push(chosenNumber);

                        // --- ADDED: Bot Win Check Logic ---
                        let botHasWon = false;
                        // ----------------------------------

                        // Line Update Logic
                        room.players.forEach(player => {
                            player.tickets.forEach((ticket, tIdx) => {
                                // Yahan hum count ki jagah array of numbers le rahe hain
                                const wonNums = checkBingoLines(ticket, room.calledNumbers);
                                player.completedLines[tIdx] = wonNums;
                                // player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
                                if (player.user_id === botUserId && wonNums.length >= 5) {
                                    botHasWon = true;
                                }
                            });
                        });

                        const playersProgress = room.players.map(player => {
                            player.tickets.forEach((ticket, tIdx) => {
                                const wonNums = checkBingoLines(ticket, room.calledNumbers);
                                player.completedLines[tIdx] = wonNums;
                                // player.completedLines[tIdx] = checkBingoLines(ticket, room.calledNumbers);
                            });
                            return {
                                user_id: player.user_id,
                                completedLines: player.completedLines,
                                missedTurns: player.missedTurns
                            };
                        });


                        // --- ADDED: Game Over Execution for Bot ---

                        // ------------------------------------------

                        const currentIndex = room.players.findIndex(p => p.user_id === botUserId);
                        const nextPlayer = room.players[(currentIndex + 1) % room.players.length];
                        room.turn = nextPlayer.user_id;
                        room.markModified('players');
                        await room.save();

                        // --- NAYA LOG: Bot Turn Finished ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: "SYSTEM",
                            event: "BOT_TURN_FINISHED",
                            details: { nextTurn: room.turn, isNextBot: !!nextPlayer.bot }
                        });
                        // console.log("playersProgress", playersProgress)
                        io.to(roomId).emit("numberCalled", { number: chosenNumber, turn: room.turn, players: playersProgress });



                        if (botHasWon) {
                            room.status = 'finished';
                            room.winner = botPlayer.name;
                            await room.save();

                            const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                            // Emit GameOver to everyone

                            // setTimeout(() => {
                            io.to(roomId).emit("gameOver", {
                                winner: botPlayer.name, user_id: botPlayer.user_id, coins: wallet?.coinsWon,
                                diamonds: wallet?.diamondsWon, players: room.players,

                            });
                            // }, 2000);

                            // Winner Reward (Optional: Agar bot ko rewards dene hain)
                            // if (wallet) {
                            //     await User.findOneAndUpdate(
                            //         { user_id: botPlayer.user_id },
                            //         { $inc: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon } }
                            //     );
                            // }

                            await Room.deleteOne({ roomId: room.roomId });
                            return; // Stop further execution
                        }
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
        socket.on("userpowercheck", async ({ roomId, user_id, verify_token }) => {
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
                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check

                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });
                        // 2. Room aur Players ka data nikalein
                        const room = await Room.findOne({ roomId });
                        if (!room) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (room.status === 'finished') return;

                        const quitter = room.players.find(p => p.user_id === user_id);
                        const winner = room.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: room.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        room.status = 'finished';
                        room.winner = winner ? winner.name : "None";
                        await room.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[roomId]) {
                            clearTimeout(turnTimeouts[roomId]);
                            delete turnTimeouts[roomId];
                        }
                        return;

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
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
        socket.on("callNumber", async ({ roomId, number, user_id, isPower, verify_token }) => { // isPower flag add kiya
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
                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check

                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });
                        // 2. Room aur Players ka data nikalein
                        const room = await Room.findOne({ roomId });
                        if (!room) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (room.status === 'finished') return;

                        const quitter = room.players.find(p => p.user_id === user_id);
                        const winner = room.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: room.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        room.status = 'finished';
                        room.winner = winner ? winner.name : "None";
                        await room.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[roomId]) {
                            clearTimeout(turnTimeouts[roomId]);
                            delete turnTimeouts[roomId];
                        }
                        return;

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
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
        socket.on("claimBingo", async ({ roomId, user_id, verify_token }) => {
            try {
                // console.log("hello")
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

                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check

                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });
                        // 2. Room aur Players ka data nikalein
                        const room = await Room.findOne({ roomId });
                        if (!room) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (room.status === 'finished') return;

                        const quitter = room.players.find(p => p.user_id === user_id);
                        const winner = room.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: room.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        room.status = 'finished';
                        room.winner = winner ? winner.name : "None";
                        await room.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[roomId]) {
                            clearTimeout(turnTimeouts[roomId]);
                            delete turnTimeouts[roomId];
                        }
                        return;

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
                }
                const room = await Room.findOne({ roomId });
                // console.log("room", room)
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
                console.log('player', player)
                // --- BINGO VALIDATION & REWARDS ---
                const totalLines = player.completedLines[0].length;
                if (player && totalLines >= 5) {

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
                    const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                    io.to(roomId).emit("gameOver", {
                        winner: player.name, user_id: player.user_id, coins: wallet?.coinsWon,
                        diamonds: wallet?.diamondsWon, players: room.players,
                    });



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
                console.log("err", err)
                await ActionLog.create({
                    roomId: roomId || "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "CLAIM_BINGO_ERROR",
                    details: { error: err.message }
                });
                console.error(err);
            }
        });
        socket.on("SendMessage", async ({ roomId, user_id, message, verify_token }) => {
            try {
                // 1. Room fetch karein

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

                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check

                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });
                        // 2. Room aur Players ka data nikalein
                        const room = await Room.findOne({ roomId });
                        if (!room) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (room.status === 'finished') return;

                        const quitter = room.players.find(p => p.user_id === user_id);
                        const winner = room.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: room.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        room.status = 'finished';
                        room.winner = winner ? winner.name : "None";
                        await room.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[roomId]) {
                            clearTimeout(turnTimeouts[roomId]);
                            delete turnTimeouts[roomId];
                        }
                        return;

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
                }
                const room = await SnakeRoom.findOne({ roomId });
                if (!room) return;

                const player = room.players.find(p => p.user_id === user_id);
                const senderName = player ? player.name : "Unknown";

                const newMessage = {
                    sender_id: user_id,
                    sender_name: senderName,
                    message: message,
                    createdAt: new Date()
                };

                // 2. Database mein chat push karein aur updated document wapas lein
                // { new: true } use karne se humein update ke baad wali list milti hai
                const updatedRoom = await SnakeRoom.findOneAndUpdate(
                    { roomId: roomId },
                    { $push: { chat: newMessage } },
                    { new: true }
                );

                // 3. Room mein sabhi ko POORI CHAT HISTORY bhej dein
                // Ab newMessage ki jagah updatedRoom.chat jayega
                io.to(roomId).emit("ReceiveMessage", {
                    chat: updatedRoom.chat
                });

            } catch (err) {
                console.error("Chat Error:", err);
            }
        });
        socket.on("quitGame", async ({ user_id, roomId, verify_token }) => {
            try {
                // 1. Authorization Check
                if (user_id != socket.verified_id) {
                    return socket.emit("error", { message: "Unauthorized!" });
                }
                const user = await User.findOne({ user_id }).lean();
                if (!user) return socket.emit("error", { message: "User not found" });

                if (!verify_token || user.verify_token !== verify_token) {
                    try {
                        // 1. Authorization Check

                        socket.emit("VerifyToken", { message: "Session expired or invalid token", isLogin: false });
                        // 2. Room aur Players ka data nikalein
                        const room = await Room.findOne({ roomId });
                        if (!room) {
                            return socket.emit("error", { message: "Room not found!" });
                        }

                        // Agar game pehle hi khatam ho chuki hai
                        if (room.status === 'finished') return;

                        const quitter = room.players.find(p => p.user_id === user_id);
                        const winner = room.players.find(p => p.user_id !== user_id);

                        if (!quitter) return;

                        // --- STEP 1: LOG QUIT EVENT ---
                        await ActionLog.create({
                            roomId: roomId,
                            userId: user_id,
                            userName: quitter.name,
                            event: "USER_QUIT_GAME",
                            details: {
                                msg: "Player manually quit the game",
                                opponent_won: winner ? winner.name : "No Opponent"
                            }
                        });

                        // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                        if (winner && !winner.bot) {
                            const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                            if (wallet) {
                                // Winner ko rewards dena
                                await User.findOneAndUpdate(
                                    { user_id: winner.user_id },
                                    {
                                        $inc: {
                                            coins: wallet.coinsWon,
                                            diamonds: wallet.diamondsWon
                                        }
                                    }
                                );

                                // Winner ko notify karna
                                io.to(winner.socketId).emit("gameOver", {
                                    winner: winner.name,
                                    user_id: winner.user_id,
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon,
                                    players: room.players,
                                    reason: "Opponent quit the game."
                                });

                                // Reward Log
                                await ActionLog.create({
                                    roomId: roomId,
                                    userId: winner.user_id,
                                    event: "REWARD_ADDED_QUIT_WIN",
                                    details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                                });
                            }
                        }

                        // Quitter ko confirmation bhejna
                        // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                        // --- STEP 3: CLEANUP ---
                        // Room status update karein ya delete karein
                        room.status = 'finished';
                        room.winner = winner ? winner.name : "None";
                        await room.save();

                        // Room delete karna (jaisa aapne manga)
                        await Room.deleteOne({ roomId: roomId });

                        // Room ke baaki logo ko update dena (agar koi aur ho)
                        socket.leave(roomId);

                        // Turn timeouts clear karna agar active hain
                        if (turnTimeouts[roomId]) {
                            clearTimeout(turnTimeouts[roomId]);
                            delete turnTimeouts[roomId];
                        }
                        return;

                    } catch (err) {
                        console.error("Quit Game Error:", err);
                        await ActionLog.create({
                            roomId: roomId || "SYSTEM",
                            userId: user_id || "UNKNOWN",
                            event: "QUIT_GAME_ERROR",
                            details: { error: err.message }
                        });
                    }
                }

                // 2. Room aur Players ka data nikalein
                const room = await Room.findOne({ roomId });
                if (!room) {
                    return socket.emit("error", { message: "Room not found!" });
                }

                // Agar game pehle hi khatam ho chuki hai
                if (room.status === 'finished') return;

                const quitter = room.players.find(p => p.user_id === user_id);
                const winner = room.players.find(p => p.user_id !== user_id);

                if (!quitter) return;

                // --- STEP 1: LOG QUIT EVENT ---
                await ActionLog.create({
                    roomId: roomId,
                    userId: user_id,
                    userName: quitter.name,
                    event: "USER_QUIT_GAME",
                    details: {
                        msg: "Player manually quit the game",
                        opponent_won: winner ? winner.name : "No Opponent"
                    }
                });

                // --- STEP 2: WINNER LOGIC (Agar opponent hai toh) ---
                if (winner && !winner.bot) {
                    const wallet = await GameWallet.findOne({ _id: room.gamelobby_id });

                    if (wallet) {
                        // Winner ko rewards dena
                        await User.findOneAndUpdate(
                            { user_id: winner.user_id },
                            {
                                $inc: {
                                    coins: wallet.coinsWon,
                                    diamonds: wallet.diamondsWon
                                }
                            }
                        );

                        // Winner ko notify karna
                        io.to(winner.socketId).emit("gameOver", {
                            winner: winner.name,
                            user_id: winner.user_id,
                            coins: wallet.coinsWon,
                            diamonds: wallet.diamondsWon,
                            players: room.players,
                            reason: "Opponent quit the game."
                        });

                        // Reward Log
                        await ActionLog.create({
                            roomId: roomId,
                            userId: winner.user_id,
                            event: "REWARD_ADDED_QUIT_WIN",
                            details: { coins: wallet.coinsWon, diamonds: wallet.diamondsWon }
                        });
                    }
                }

                // Quitter ko confirmation bhejna
                // socket.emit("quitGame", {user_id :user_id, message: "You left the game." });

                // --- STEP 3: CLEANUP ---
                // Room status update karein ya delete karein
                room.status = 'finished';
                room.winner = winner ? winner.name : "None";
                await room.save();

                // Room delete karna (jaisa aapne manga)
                await Room.deleteOne({ roomId: roomId });

                // Room ke baaki logo ko update dena (agar koi aur ho)
                socket.leave(roomId);

                // Turn timeouts clear karna agar active hain
                if (turnTimeouts[roomId]) {
                    clearTimeout(turnTimeouts[roomId]);
                    delete turnTimeouts[roomId];
                }

            } catch (err) {
                console.error("Quit Game Error:", err);
                await ActionLog.create({
                    roomId: roomId || "SYSTEM",
                    userId: user_id || "UNKNOWN",
                    event: "QUIT_GAME_ERROR",
                    details: { error: err.message }
                });
            }
        });
    });

};