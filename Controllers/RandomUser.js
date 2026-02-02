const RandomUser = require("../Models/RandomUser");

module.exports = {

    // INSERT
    insert: async (req, res) => {
        try {
            const { username, avatar } = req.body;

            if (!username || !avatar) {
                return res.status(400).json({
                    success: false,
                    message: "username and avatar are required"
                });
            }

            const user = await RandomUser.create({ username, avatar });

            return res.json({
                success: true,
                message: "User inserted",
                data: user
            });

        } catch (err) {
            return res.status(500).json({
                success: false,
                message: err.message
            });
        }
    },

    // UPDATE (id from body)
    update: async (req, res) => {
        try {
            const { id, username, avatar } = req.body;

            if (!id) return res.status(400).json({ success: false, message: "id is required" });

            const updated = await RandomUser.findByIdAndUpdate(
                id,
                { username, avatar },
                { new: true }
            );

            if (!updated) return res.json({ success: false, message: "User not found" });

            return res.json({
                success: true,
                message: "User updated",
                data: updated
            });

        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    },

    // DELETE
    delete: async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ success: false, message: "id is required" });

            const deleted = await RandomUser.findByIdAndDelete(id);
            if (!deleted) return res.json({ success: false, message: "User not found" });

            return res.json({ success: true, message: "User deleted" });

        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    },

    // SELECT ALL
    selectAll: async (req, res) => {
        try {
            const users = await RandomUser.find().sort({ createdAt: -1 });

            return res.json({ success: true, data: users });

        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    },

    // SELECT BY ID
    selectById: async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ success: false, message: "id is required" });

            const user = await RandomUser.findById(id);
            if (!user) return res.json({ success: false, message: "User not found" });

            return res.json({ status: true, data: user });

        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    },

    // SELECT RANDOM USER
    selectRandom: async (req, res) => {
        try {
            const users = await RandomUser.aggregate([{ $sample: { size: 1 } }]);
            return res.json({ success: true, data: users[0] || null });
        } catch (err) {
            return res.status(500).json({ success: false, message: err.message });
        }
    },
    insertBulk: async (req, res) => {
        try {
            const names = [
                "Shiva", "Vishnu", "Brahma", "Krishna", "Rama", "Hanuman",
                "Ganesha", "Shankar", "Mahadev", "Narayan", "Hari", "Govind",
                "Gopal", "Madhav", "Keshav", "Damodar", "Vasudev", "Janardan",
                "Raghav", "Raghunath", "Ramchandra", "Lakshman", "Bharat",
                "Shatrughna", "Parshuram", "Narsimha", "Vamana", "Varaha",
                "Kurma", "Matsya", "Buddha", "Kalki", "Indra", "Agni", "Vayu",
                "Surya", "Chandra", "Yama", "Varun", "Kubera", "Kamdev",
                "Shani", "Rahu", "Ketu", "Durga", "Parvati", "Lakshmi",
                "Saraswati", "Kali", "Sita", "Radha", "Rukmini", "Meera",
                "Skanda", "Kartikeya", "Murugan", "Ayyappa", "Dattatreya",
                "Balram", "Sudama", "Uddhav", "Nandi", "Garuda", "Ashwini",
                "Narada", "Valmiki", "Vedvyas", "Markandeya", "Prahlad",
                "Dhruv", "Nachiketa", "Kapil", "Rishi", "Vishwakarma",
                "Brihaspati", "Chaitanya", "Ramanuja", "Shankaracharya",
                "Kabir", "Tulsidas", "Surdas", "Namdev", "Eknath",
                "Tukaram", "SantDnyaneshwar", "SaiBaba", "Swaminarayan",
                "Ramakrishna", "Vivekananda", "Aurobindo", "Mahavir"
            ];

            const bulkOps = names.map(name => {
                const avatar = Math.floor(Math.random() * 7) + 1;

                return {
                    updateOne: {
                        filter: { username: name },
                        update: {
                            $set: {
                                avatar: avatar,
                                updatedAt: new Date()
                            }
                        },
                        upsert: true
                    }
                };
            });

            const result = await RandomUser.bulkWrite(bulkOps);

            return res.json({
                success: true,
                message: "Users inserted / updated successfully",
                inserted: result.upsertedCount,
                updated: result.modifiedCount
            });

        } catch (err) {
            return res.status(500).json({
                success: false,
                message: err.message
            });
        }
    }


};
