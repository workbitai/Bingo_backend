const crypto = require("crypto");
const User = require("../Models/Users");

const BingoRoom = require("../Models/BingoRoom")

const { generateToken } = require("../Utils/generateToken")

require("dotenv").config();
class UsersController {

  async loginOrSignup(req, res) {
    try {
      const {
        user_id,
        username,
        isGuest,
        firebaseToken,
        profile_pic,
        avatar,
        email
      } = req.body;

      console.log("req.body", req.body)

      if (!isGuest && (!user_id || !username)) {
        return res.status(400).json({
          success: false,
          message: "user_id and username are required for non-guest users"
        });
      }
    let queryConditions = [];
      if (email && email !== "" && email !== null) {
        queryConditions.push({ email: email });
      }

      // 3. User_id hamesha hota hai, toh use add karein
      if (user_id) {
        queryConditions.push({ user_id: user_id });
      }

      // 4. Sirf tab find karein jab hamare paas koi condition ho
      let user = null;
      if (queryConditions.length > 0) {
        user = await User.findOne({ $or: queryConditions });
      }

      if (user) {

        if (firebaseToken) {
          user.firebaseToken = firebaseToken;
        }

        // 🔹 JWT generate (permanent)
        if (!user.jwtToken) {
          user.jwtToken = generateToken(user);
        }

        // ✅ 🔥 VERIFY TOKEN ADD (har login par change hoga)
        const verifyToken = crypto.randomBytes(32).toString("hex");
        user.verify_token = verifyToken;

        user.lastLogin = new Date();

        await user.save();

        let responseUser = user.toObject();

        

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
        trophies: 0,
        avatar: avatar || 1,
        profile_pic : profile_pic || null,
        email:email || null
      });

      // 👉 Profile Pic
     

      newUser.jwtToken = generateToken(newUser);

      // ✅ 🔥 VERIFY TOKEN ADD (new user ke liye bhi)
      const verifyToken = crypto.randomBytes(32).toString("hex");
      newUser.verify_token = verifyToken;

      await newUser.save();

      let responseUser = newUser.toObject();

     

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


  async getUserActiveGame(req, res) {
    try {
      const { user_id, GameName } = req.body;

      // Validation
      if (!user_id || !GameName) {
        return res.status(400).json({
          success: false,
          message: "user_id and GameName are required"
        });
      }

      let ActiveModel;

      // 1. GameName ke basis par Model select karein
      // Yahan aap apne saare games ke name aur unke corresponding Models add karein
      let room = null;

      switch (GameName.toLowerCase()) {
      
        case 'bingo':
          // Bingo ke liye specific fields
          room = await BingoRoom.findOne({
            "players.user_id": user_id,
            status: { $in: ["setup", "playing"] }
          }).select("roomId gamelobby_id maxPlayers status  players isPrivate joinKey");
          break;

       
        default:
          return res.status(400).json({
            success: false,
            message: "Invalid Game Name"
          });
      }

      // 3. Response handle karein

      if (!room) {
        return res.json({
          success: true,
          gameActive: false,
          data: null
        });
      }
      const currentPlayer = room.players.find(p => p.user_id.toString() === user_id.toString());
      // 3. Response bhejein
      return res.json({
        success: true,
        gameActive: true,
        data: {
          roomId: room.roomId,
          gamelobby_id: room.gamelobby_id,
          maxPlayers: room.players ? room.players.length : 0, // maxPlayers schema mein na ho toh players count le sakte hain
          status: room.status,
          isGameActive: true,
          joinKey: room.joinKey ? room.joinKey : null,
          isPrivate: room.isPrivate ? room.isPrivate : null,
          color: currentPlayer ? currentPlayer.color : null
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

  async CheckUserCoin(req, res) {
    try {
      const {
        user_id,
        // avatar_id (1–7)
      } = req.body;
      // console.log("req.body",req.body)
      if (!user_id) {
        return res.status(400).json({
          success: false,
          message: "user_id and username are required for non-guest users"
        });
      }

      let user = await User.findOne({ user_id });
      // console.log("user",user)



      let responseUser = user.toObject();

      // console.log("responseUser",responseUser)
      

      

      return res.json({
        success: true,
        message: "User found",
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
  async verifyToken(req, res) {
    try {
      const { user_id, verify_token } = req.body;
      // console.log("verify_token",verify_token)
      if (!user_id || !verify_token) {
        return res.status(400).json({
          success: false,
          message: "user_id and verify_token required"
        });
      }

      const user = await User.findOne({ user_id });

      if (!user) {
        return res.json({
          success: true,
          isLogin: false
        });
      }

      // ✅ Token match check
      if (user.verify_token === verify_token) {
        // console.log("true")
        return res.json({
          success: true,
          isLogin: true
        });
      } else {
        // console.log("false")
        return res.json({
          success: true,
          isLogin: false
        });
      }

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Verification failed",
        error: error.message
      });
    }
  }
  async updateProfile(req, res) {
    try {
      const { user_id, username, avatar, isGuest, isGoogleLogin, email, profile_pic, coins} = req.body;
      console.log(req.body);
      if (!user_id) {
        return res.status(400).json({ success: false, message: "user_id is required" });
      }

      // User dhoondein
      const user = await User.findOne({ user_id });
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      // Fields update karein (sirf wahi jo body mein aaye hain)
      if (username) user.username = username;
      if (avatar) user.avatar = avatar;
      if (isGoogleLogin !== undefined) user.isGoogleLogin = isGoogleLogin;
      if (isGuest !== undefined) user.isGuest = isGuest;
      if (email) user.email = email;
      if (profile_pic) user.profile_pic = profile_pic;
      if (coins) user.coins = coins;

      // Session extend logic (Kyuki user ne profile update ki hai, matlab wo active hai)
      user.lastLogin = Date.now();
      if (user.isGuest) {
        user.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else {
        user.expiresAt = null;
      }

      await user.save();

      // Response mein updated image path dikhane ke liye logic
      let responseData = user.toObject();
      // if (responseData.avatar) {
      //   const avatarPath = getAvatarById(responseData.avatar);
      //   responseData.profile_pic = process.env.BASE_URL + avatarPath;
      // }

      return res.json({
        success: true,
        message: "Profile updated successfully",
        data: responseData
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Update failed",
        error: error.message
      });
    }
  }
}

module.exports = new UsersController();
