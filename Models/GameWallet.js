const mongoose = require("mongoose");

const GameWalletSchema = new mongoose.Schema(
  {
    coinsWon: {
      type: Number,
      default: 0
    },

    trophiesWon: {
      type: Number,
      default: 0
    },

    entryCoinsUsed: {
      type: Number,
      required: true
    },
    players: {
      type: Number,
      required: true
    },
    isLock:{
      type:Boolean,
      require:false
    },
    GameName:{
      type:String,
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

module.exports = mongoose.model("GameWallet", GameWalletSchema);
