const mongoose = require("mongoose");

const RandomUserSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true
        },
        avatar: {
            type: Number, // URL ya base64 image
            required: true
        }
    },
    {
        timestamps: true,
        versionKey: false
    }
);

module.exports = mongoose.model("RandomUser", RandomUserSchema);
