const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      // unique: true,
      trim: true
    },
    user_id: {
      type: String,
      required: function () {
        // Required only if not guest
        return !this.isGuest;
      },
      unique: true
    },
    avatar: {
      type: Number,
      default: 1
    },
    isGuest: {
      type: Boolean,
      default: false
    },
    coins: {
      type: Number,
      default: 1000
    },
     email: {
      type: String,

    },
    trophies: {
      type: Number,
      default: 0
    },
    profile_pic: {
      type: String,
      default: null
    },
    jwtToken: {
      type: String,
      default: null
    },
    firebaseToken: {
      type: String,
      default: null
    },
    googlelogin: {
      type: Boolean,
      default: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
     lastLogin: {
      type: Date,
      default: Date.now
    },
     verify_token: String,
    power: { type: Number, default: 1 },
    expiresAt: {
      type: Date,
      default: function () {
        if (this.isGuest) {
          // Aaj se 30 din baad ki date
          return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        }
        return null; // Normal users ke liye koi expiry nahi
      },
      index: { expires: 0 } // MongoDB index jo timer 0 hote hi delete kar dega
    }
  },
  {
    versionKey: false // remove __v
  }
);

module.exports = mongoose.model("User", UserSchema);
