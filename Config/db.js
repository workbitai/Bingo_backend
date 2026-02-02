const mongoose = require("mongoose");

const connectDB = async () => {
    try {
        const {
            DB_HOST,
            DB_PORT,
            DB_NAME,
            DB_USER,
            DB_PASS
        } = process.env;

        const uri = process.env.MONGO_URI || `mongodb://localhost:27017/${DB_NAME}`;

        await mongoose.connect(uri);

        console.log("✅ MongoDB Connected");
    } catch (error) {
        console.error("❌ MongoDB Connection Failed:", error.message);
        process.exit(1);
    }
};

module.exports = connectDB;
