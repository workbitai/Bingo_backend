// [0,2,3][1,4]
require("dotenv").config();
const express = require("express");
const http = require("http");
const connectDB = require("./Config/db");
const cors = require("cors");
const app = express();
const path = require("path");
app.use(express.json());
app.use(cors({
    origin: "*", // Production mein yahan specific URL daalein
    methods: ["GET", "POST"]
}));
// DB
connectDB();
// Routes
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/api/Users", require("./Routes/Users"));
app.use("/api/GameLobby", require("./Routes/GameWallet"));

app.use("/api/RandomUser", require("./Routes/RandomUser"));


// HTTP servers
const server = http.createServer(app);

// 🔗 SOCKET ATTACH
require("./Socket/Socket")(server);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`🚀 Server + Socket running on port ${PORT}`);
});
