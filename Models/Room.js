const mongoose = require('mongoose');
const ChatSchema = new mongoose.Schema({
    sender_id: String,
    sender_name: String,
    sender_avatar: String,
    bot: {
        type: Boolean,
        default: false
    },
    message: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});
const PlayerSchema = new mongoose.Schema({
    user_id: String,
    name: String,
    socketId: String,
    avatar: String,
    hasUsedPower: { type: Boolean, default: true }, // Game mein sirf ek baar true hoga
    powerTurnCount: { type: Number, default: 0 },
    bot: { type: Boolean, default: false },
    tickets: [[[Number]]], // 3D Array (Cards > Rows > Columns)
    completedLines: {
        type: [Number], // Example: [2, 0] pehle ticket ki 2 lines, dusre ki 0
        default: [0, 0, 0, 0] // Jitne cards allow kar rahe hain utne 0 rakh sakte hain
    },
    turn: { type: Number, default: 0 },
    isReady: { type: Boolean, default: false },
    hasLeft: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    missedTurns: { type: Number, default: 0 },
});
const BingoRoomSchema = new mongoose.Schema({
    roomId: { type: String, required: true, unique: true },
    players: [PlayerSchema],
    joinKey: { type: String, unique: true, sparse: true },
    isPrivate: { type: Boolean, default: false }, // Private flag
    adminId: String, // Room creator ki ID
    maxPlayers: { type: Number, default: 10 },
    gamelobby_id: { type: String },
    status: {
        type: String,
        enum: ['waiting', 'setup', 'playing', 'finished'],
        default: 'waiting'
    },
    joinUrl:{type:String},
    // Wo numbers jo game mein ab tak nikal chuke hain
    calledNumbers: { type: [Number], default: [] },
    // Agla number kab aayega uska timer ya turn
    turn: String,
    chat: [ChatSchema],
    winner: { type: String, default: null },
    createdAt: { type: Date, default: Date.now, expires: 86400 }
});

module.exports = mongoose.model('Room', BingoRoomSchema);