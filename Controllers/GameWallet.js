const GameWallet = require("../Models/GameWallet");
const User = require("../Models/Users");
module.exports = {

    // ✅ INSERT
    insert: async (req, res) => {
        try {
            const { coinsWon, diamondsWon, entryCoinsUsed, players, isLock } = req.body;

            if (entryCoinsUsed === undefined) {
                return res.status(400).json({
                    success: false,
                    message: "entryCoinsUsed is required"
                });
            }

            const data = await GameWallet.create({
                coinsWon,
                diamondsWon,
                entryCoinsUsed, players, isLock
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
            const { id, coinsWon, diamondsWon, entryCoinsUsed, players, isLock } = req.body;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    message: "id is required"
                });
            }

            const updated = await GameWallet.findByIdAndUpdate(
                id,
                { coinsWon, diamondsWon, entryCoinsUsed, players, isLock },
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
            const { user_id } = req.body;

            // 1. Check user_id provided or not
            if (!user_id) {
                return res.status(400).json({ status: false, message: "user_id is required" });
            }

            const userStats = await User.findOne({ user_id: user_id }).select("coins diamonds");

            // Fetch all games
            const allGames = await GameWallet.find();

            // 2 players - filtered and sorted by entryCoinsUsed (Ascending)
            const twoPlayersGames = allGames
                .filter(g => g.players === 2)
                .sort((a, b) => a.entryCoinsUsed - b.entryCoinsUsed);

            // 4 players - filtered and sorted by entryCoinsUsed (Ascending)
            const fourPlayersGames = allGames
                .filter(g => g.players === 4)
                .sort((a, b) => a.entryCoinsUsed - b.entryCoinsUsed);

            return res.json({
                success: true,
                data: {
                    coins: userStats ? userStats.coins : 0,
                    diamonds: userStats ? userStats.diamonds : 0,
                    twoPlayersGames,
                    fourPlayersGames
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
                    status: false,
                    message: "id is required"
                });
            }

            const data = await GameWallet.findById(id);

            if (!data) {
                return res.json({
                    status: false,
                    message: "Record not found"
                });
            }

            return res.json({
                status: true,
                data
            });

        } catch (err) {
            return res.status(500).json({
                status: false,
                message: err.message
            });
        }
    }
};
