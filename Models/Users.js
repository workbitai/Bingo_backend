// const mongoose = require("mongoose");

// const UserSchema = new mongoose.Schema(
//   {
//     username: {
//       type: String,
//       required: true,
//       unique: true,
//       trim: true
//     },
//     user_id: {
//       type: String,
//       required: function () {
//         // Required only if not guest
//         return !this.isGuest;
//       },
//       unique: true
//     },
//     avatar:{
//         type:Number,
//         default:1
//     },
//     isGuest: {
//       type: Boolean,
//       default: false
//     },
//     coins: {
//       type: Number,
//       default: 1000
//     },
//     diamonds: {
//       type: Number,
//       default: 50
//     },
//     profile_pic: {
//       type: String,
//       default: null
//     },
//     jwtToken: {
//       type: String,
//       default: null
//     },
//     firebaseToken: {
//       type: String,
//       default: null
//     },
//     googlelogin:{
//          type: Boolean,
//       default: false
//     },
//     facebooklogin:{
//         type:Boolean,
//         default:false
//     },
//     createdAt: {
//       type: Date,
//       default: Date.now
//     }
//   },
//   {
//     versionKey: false // remove __v
//   }
// );

// module.exports = mongoose.model("User", UserSchema);


const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },

    user_id: {
      type: String,
      required: function () {
        return !this.isGuest;
      },
      unique: true
    },

    avatar: { type: Number, default: 1 },

    isGuest: {
      type: Boolean,
      default: false
    },
    power:{type:Number,default:1},
    coins: { type: Number, default: 1000 },
    diamonds: { type: Number, default: 50 },

    profile_pic: { type: String, default: null },
    jwtToken: { type: String, default: null },
    firebaseToken: { type: String, default: null },
    googlelogin: { type: Boolean, default: false },

    createdAt: {
      type: Date,
      default: Date.now
    },

    lastLogin: {
      type: Date,
      default: Date.now
    },

    // 🔥 TTL FIELD
    expiresAt: {
      type: Date
    }
  },
  { versionKey: false }
);

// 🔥 TTL INDEX (ONLY FOR GUEST USERS)
UserSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { isGuest: true }
  }
);

module.exports = mongoose.model("User", UserSchema);
