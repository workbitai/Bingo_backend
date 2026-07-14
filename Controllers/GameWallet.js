const GameWallet = require("../Models/GameWallet");
const User = require("../Models/Users");
module.exports = {

  // ✅ INSERT
  insert: async (req, res) => {
    try {
      const { coinsWon, trophiesWon, entryCoinsUsed, players, GameName, isLock } = req.body;

      if (entryCoinsUsed === undefined) {
        return res.status(400).json({
          success: false,
          message: "entryCoinsUsed is required"
        });
      }

      const data = await GameWallet.create({
        coinsWon,
        trophiesWon,
        players, GameName,
        entryCoinsUsed, isLock
      });

      return res.json({
        success: true,
        message: "Inserted successfully",
        data
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  // ✅ UPDATE (id body se)
  update: async (req, res) => {
    try {
      const { id, coinsWon, trophiesWon, entryCoinsUsed, isLock } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "id is required"
        });
      }

      const updated = await GameWallet.findByIdAndUpdate(
        id,
        { coinsWon, trophiesWon, entryCoinsUsed, isLock },
        { new: true }
      );

      if (!updated) {
        return res.json({
          success: false,
          message: "Record not found"
        });
      }

      return res.json({
        success: true,
        message: "Updated successfully",
        data: updated
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  // ✅ DELETE (id body se)
  delete: async (req, res) => {
    try {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "id is required"
        });
      }

      const deleted = await GameWallet.findByIdAndDelete(id);

      if (!deleted) {
        return res.json({
          success: false,
          message: "Record not found"
        });
      }

      return res.json({
        success: true,
        message: "Deleted successfully"
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  // ✅ SELECT ALL
  // POST /select-player-wise
  selectPlayerWise: async (req, res) => {
    try {
      const { user_id, GameName } = req.body;

      // 1. Validate user_id
      if (!user_id) {
        return res.status(400).json({ success: false, message: "user_id is required" });
      }
      if(!GameName){
        return res.status(400).json({ success: false, message: "GameName is required" });
      }
      // 2. Validate player
      // if (![2, 3, 4].includes(player)) {
      //   return res.status(400).json({
      //     success: false,
      //     message: "player must be 2, 3 or 4"
      //   });
      // }

      // 3. Get user stats
      const userStats = await User.findOne({ user_id }).select("coins trophies");

      // 4. Fetch player-wise games and sort
      const allGames = await GameWallet.find({ GameName: GameName })
        .sort({ entryCoinsUsed: 1 });

            const twoPlayersGames = allGames
      .filter(g => g.players === 2)
      .sort((a, b) => a.entryCoinsUsed - b.entryCoinsUsed);

    // 4 players - filtered and sorted by entryCoinsUsed (Ascending)
    const ThreePlayerGame = allGames
      .filter(g => g.players === 3)
      .sort((a, b) => a.entryCoinsUsed - b.entryCoinsUsed);
    const fourPlayersGames = allGames
      .filter(g => g.players === 4)
      .sort((a, b) => a.entryCoinsUsed - b.entryCoinsUsed);
      return res.json({
        success: true,
        data: {
          coins: userStats ? userStats.coins : 0,
          trophies: userStats ? userStats.trophies : 0,
          
          twoPlayersGames: twoPlayersGames,
          threePlayerGame:ThreePlayerGame,
          fourPlayersGames:fourPlayersGames
        }
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  },

  

  // ✅ SELECT BY ID (id body se)
  selectById: async (req, res) => {
    try {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "id is required"
        });
      }

      const data = await GameWallet.findById(id);

      if (!data) {
        return res.json({
          success: false,
          message: "Record not found"
        });
      }

      return res.json({
        success: true,
        data
      });

    } catch (err) {
      return res.status(500).json({
        success: false,
        message: err.message
      });
    }
  }
};
