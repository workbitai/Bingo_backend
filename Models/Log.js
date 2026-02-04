const mongoose = require('mongoose');

const ActionLogSchema = new mongoose.Schema({
    roomId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    userName: { type: String },
    event: { type: String, required: true }, // Jaise: "DRAW_CARD", "MOVE_PAWN"
    details: { type: Object }, // Card info, positions, etc.
    timestamp: { type: Date, default: Date.now }
}, { 
    // Isse log 24 hours baad automatically delete ho jayega
    timestamps: true 
});

// 86400 seconds = 24 hours
ActionLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

const ActionLog = mongoose.model("Log", ActionLogSchema);
module.exports = ActionLog;