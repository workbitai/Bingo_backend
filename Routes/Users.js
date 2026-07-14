const express = require("express");
const router = express.Router();
const Users = require("../Controllers/Users");
const { verifyToken } = require("../Utils/generateToken");

router.post("/Login", Users.loginOrSignup);
router.post("/CheckUserCoin", verifyToken,Users.CheckUserCoin);
router.post("/active-game", verifyToken,Users.getUserActiveGame);
router.post("/Verify-token", verifyToken,Users.verifyToken);
router.post("/Update", verifyToken,Users.updateProfile);



module.exports = router;
