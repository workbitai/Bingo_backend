const User = require("../Models/Users");
const { generateToken } = require("../Utils/generateToken")
const saveImage = require("../Utils/saveImage")
const Room = require("../Models/Room");

const getAvatarById = require("../Utils/getAvatarById")
require("dotenv").config();
class UsersController {

  async loginOrSignup(req, res) {
    try {
      const {
        user_id,
        username,
        isGuest,
        firebaseToken,
        profile_pic, // base64
        avatar,
        googlelogin,
        facebooklogin
        // avatar_id (1–7)
      } = req.body;
      console.log("req.body", req.body)
      if (!isGuest && (!user_id || !username)) {
        return res.status(400).json({
          success: false,
          message: "user_id and username are required for non-guest users"
        });
      }

      let user = await User.findOne({ user_id });
      // console.log("user",user)
      if (user) {

        if (firebaseToken) {
          user.firebaseToken = firebaseToken;
        }

        // 🔹 JWT generate (permanent)
        if (!user.jwtToken) {
          user.jwtToken = generateToken(user);
        }

        await user.save();


        let responseUser = user.toObject();

        // console.log("responseUser",responseUser)
        if (responseUser.profile_pic) {
          responseUser.profile_pic =
            process.env.BASE_URL + responseUser.profile_pic;
        } else {
          const avatarPath = getAvatarById(responseUser.avatar);
          responseUser.profile_pic =
            process.env.BASE_URL + avatarPath;
        }

        // console.log("responseUser", responseUser)
        return res.json({
          success: true,
          message: "User found",
          data: responseUser
        });
      }

      /* =========================
         🔹 CREATE NEW USER
      ========================== */
      const newUser = new User({
        user_id: user_id || `guest_${Date.now()}`,
        username: username || "Guest",
        isGuest: !!isGuest,
        firebaseToken: firebaseToken || null,
        coins: 1000,
        diamonds: 50,
        googlelogin: googlelogin || false,
        facebooklogin: facebooklogin || false,
        avatar: avatar || 1,
      });

      // 👉 Profile Pic
      if (profile_pic) {
        const imgPath = saveImage(
          profile_pic,
          "Users",
          newUser.username,
          newUser.user_id
        );

        newUser.profile_pic = imgPath;

      }



      newUser.jwtToken = generateToken(newUser);
      await newUser.save();
      // console.log("newUser", newUser)
      let responseUser = newUser.toObject();

      // 👉 Agar profile_pic saved hai (user upload wali)
      if (responseUser.profile_pic) {
        responseUser.profile_pic =
          process.env.BASE_URL + responseUser.profile_pic;
      }
      // 👉 Agar profile_pic nahi hai → avatar se do
      else {
        const avatarPath = getAvatarById(responseUser.avatar_id || responseUser.avatar);
        responseUser.profile_pic =
          process.env.BASE_URL + avatarPath;
      }
      // console.log("responseUser", responseUser)
      return res.status(201).json({
        success: true,
        message: "User created successfully",
        data: responseUser
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Operation failed",
        error: error.message
      });
    }
  }
  async updateSession(req, res) {
    try {
      const { user_id } = req.body;

      if (!user_id) {
        return res.status(400).json({ success: false, message: "user_id is required" });
      }

      const user = await User.findOne({ user_id });

      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // 1. Update lastLogin date
      await User.findOneAndUpdate(
        { user_id },
        {
          $set: {
            lastLogin: new Date(),
            ...(user.isGuest && {
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            })
          }
        }
      );


      return res.json({
        success: true,
        message: "Session extended successfully",
        expiresAt: user.expiresAt
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Server Error",
        error: error.message
      });
    }
  }
  // async updateProfile(req, res) {
  //   try {
  //     const { user_id, username, avatar } = req.body;

  //     if (!user_id) {
  //       return res.status(400).json({ success: false, message: "user_id is required" });
  //     }

  //     // User dhoondein
  //     const user = await User.findOne({ user_id });
  //     if (!user) {
  //       return res.status(404).json({ success: false, message: "User not found" });
  //     }

  //     // Fields update karein (sirf wahi jo body mein aaye hain)
  //     if (username) user.username = username;
  //     if (avatar) user.avatar = avatar;

  //     // Session extend logic (Kyuki user ne profile update ki hai, matlab wo active hai)
  //     user.lastLogin = Date.now();
  //     if (user.isGuest) {
  //       user.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  //     }

  //     await user.save();

  //     // Response mein updated image path dikhane ke liye logic
  //     let responseData = user.toObject();
  //     if (responseData.avatar) {
  //       const avatarPath = getAvatarById(responseData.avatar);
  //       responseData.profile_pic = process.env.BASE_URL + avatarPath;
  //     }

  //     return res.json({
  //       success: true,
  //       message: "Profile updated successfully",
  //       data: responseData
  //     });

  //   } catch (error) {
  //     return res.status(500).json({
  //       success: false,
  //       message: "Update failed",
  //       error: error.message
  //     });
  //   }
  // }
  async updateProfile(req, res) {
  try {
    const { user_id, username, avatar } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required" });
    }

    const user = await User.findOne({ user_id });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (username !== undefined) user.username = username;
    if (avatar !== undefined) user.avatar = avatar;

    // 🔥 Active user → session extend
    user.lastLogin = new Date();
    if (user.isGuest) {
      user.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    await user.save();

    let responseData = user.toObject();
    if (responseData.avatar !== undefined) {
      const avatarPath = getAvatarById(responseData.avatar);
      responseData.profile_pic = process.env.BASE_URL + avatarPath;
    }

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: responseData
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Username already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Update failed",
      error: error.message
    });
  }
}

async getUserActiveGame(req, res) {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "user_id is required"
      });
    }

    const room = await Room.findOne({
      "players.user_id": user_id,
      status: { $in: ["setup", "playing"] }
    }).select("roomId gamelobby_id maxPlayers status");
    // console.log("room",room)
    if (!room) {
      return res.json({
        success: true,
        gameActive: false,
        data: null
      });
    }

    return res.json({
      success: true,
      gameActive: true,
      data: {
        roomId: room.roomId,
        gamelobby_id: room.gamelobby_id,
        maxPlayers: room.maxPlayers,
        status: room.status,
        isGameActive: true
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch active game",
      error: error.message
    });
  }
}


}

module.exports = new UsersController();
