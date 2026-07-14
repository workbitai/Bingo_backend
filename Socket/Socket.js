const { Server } = require("socket.io");
// const DotsAndBox = require("./DotsAndBox");

module.exports = (server) => {
    const io = new Server(server, {
        cors: { origin: "*" }
    });

    // Namespaces
  
    const BingoIO = io.of("/Bingo");


    require("./Bingo")(BingoIO);
    
};
