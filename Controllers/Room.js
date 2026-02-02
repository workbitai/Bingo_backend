const Room = require('../Models/Room'); // Aapka model path
const gameIntervals = new Map();

async function startNumberCalling(roomId, io) {
    if (gameIntervals.has(roomId)) {
        clearInterval(gameIntervals.get(roomId));
    }

    const interval = setInterval(async () => {
        try {
            const room = await Room.findOne({ roomId });

            if (!room || room.status !== 'playing') {
                console.log(`Stopping interval for room: ${roomId}`);
                clearInterval(interval);
                gameIntervals.delete(roomId);
                return;
            }

            // --- NAYA LOGIC START: Tickets se numbers nikalna ---

            // 1. Sabhi players ke tickets ko ek single flat array mein le aao
            let allTicketNumbers = [];
            room.players.forEach(player => {
                player.tickets.forEach(ticket => {
                    // ticket ek 5x5 array hai, ise flat karke numbers nikal lo
                    allTicketNumbers.push(...ticket.flat());
                });
            });

            // 2. Sirf unique numbers rakho aur '0' (star) ko hata do
            let uniqueNumbersOnBoard = [...new Set(allTicketNumbers)].filter(n => n !== 0);

            // 3. Wo numbers dekho jo abhi tak call NAHI huye hain
            let available = uniqueNumbersOnBoard.filter(n => !room.calledNumbers.includes(n));

            // --- NAYA LOGIC END ---

            // Agar saare numbers call ho gaye (waise aisa hoga nahi jab tak koi jeete na)
            if (available.length === 0) {
                console.log("No more numbers left on tickets.");
                clearInterval(interval);
                gameIntervals.delete(roomId);
                return;
            }

            // Randomly pick a number from available list
            const nextNum = available[Math.floor(Math.random() * available.length)];



            const updatedRoom = await Room.findOneAndUpdate(
                { roomId },
                { $push: { calledNumbers: nextNum } },
                { new: true }
            );

            io.to(roomId).emit("newNumber", {
                display: `${nextNum}`,
                number: nextNum,
                history: updatedRoom.calledNumbers
            });

        } catch (err) {
            console.log(`Error in room ${roomId}:`, err);
        }
    }, 10000);

    gameIntervals.set(roomId, interval);
}



async function createActualBingoRoom(roomKey, maxPlayers, waitingRooms, io) {
    const roomData = waitingRooms.get(roomKey);
    if (!roomData) return;

    // Timer ko clear karein agar koi pending hai
    if (roomData.timer) clearTimeout(roomData.timer);

    const roomId = "BINGO_" + Date.now();

    const newRoom = new Room({
        roomId: roomId,
        players: roomData.players,
        maxPlayers: Number(maxPlayers),
        status: 'playing',
        turn: roomData.players[0].user_id
    });

    try {
        await newRoom.save();

        roomData.players.forEach(p => {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.join(roomId);
        });

        io.to(roomId).emit("gameStarted", {
            roomId: roomId,
            players: newRoom.players,
            status: 'playing'
        });

        waitingRooms.delete(roomKey);
    } catch (err) {
        console.error("Room Creation Error:", err);
    }
}




function shuffleArray(array) {
    let newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
}

function generateBingoTicket(baseTicket = null) {
    let numbersToUse = [];

    if (baseTicket) {
        // 1. Agar baseTicket (Player 1 ka ticket) mil raha hai
        // Toh uske saare numbers (except 0) ko ek single array mein nikal lo
        baseTicket.forEach(col => {
            col.forEach(num => {
                if (num !== 0) numbersToUse.push(num);
            });
        });
    } else {
        // 2. Agar baseTicket nahi hai (Matlab ye Player 1 hai)
        // Toh fresh 1-50 mein se 24 random numbers le lo
        let pool = Array.from({ length: 50 }, (_, i) => i + 1);
        let shuffledPool = shuffleArray(pool);
        numbersToUse = shuffledPool.slice(0, 24); // 24 numbers + 1 middle zero = 25
    }

    // 3. Numbers ko shuffle karo taki har player ka order alag ho
    let randomizedNumbers = shuffleArray(numbersToUse);

    // 4. Inhe 5x5 grid (Columns) mein convert karo
    let ticket = [];
    let count = 0;

    for (let colIndex = 0; colIndex < 5; colIndex++) {
        let column = [];
        for (let rowIndex = 0; rowIndex < 5; rowIndex++) {
            if (colIndex === 2 && rowIndex === 2) {
                // Middle Cell ko hamesha 0 (Star) rakho
                column.push(0);
            } else {
                column.push(randomizedNumbers[count]);
                count++;
            }
        }
        ticket.push(column);
    }

    return ticket;
}



async function addBotAndStartGame(totalPlayers, count, waitingRooms, io) {
    const roomKey = `${totalPlayers}_${count}`;
    const roomData = waitingRooms.get(roomKey);

    if (!roomData || roomData.players.length >= totalPlayers) return;

    const firstPlayer = roomData.players[0];
    const cardCount = firstPlayer.tickets.length;

    let botTickets = [];
    let botMarked = [];
    let botLines = [];

    for (let i = 0; i < cardCount; i++) {
        // PASSING FIRST PLAYER TICKET: Numbers same rahenge, index badal jayega
        const shuffledTicket = generateBingoTicket(firstPlayer.tickets[i]);
        botTickets.push(shuffledTicket);

        botMarked.push([0]);
        botLines.push(0);
    }

    roomData.players.push({
        user_id: "BOT_" + Math.random().toString(36).substr(2, 5),
        name: "Bot_Master",
        socketId: "BOT_SOCKET",
        avatar: "bot_avatar.png",
        tickets: botTickets,
        markedNumbers: botMarked,
        completedLines: botLines,
        score: 0,
        bot: true
    });

    console.log("Bot added with shuffled but same numbers.");
    await createActualBingoRoom(roomKey, totalPlayers, waitingRooms, io);
}


module.exports = {
    createActualBingoRoom,
    addBotAndStartGame,
    generateBingoTicket
};