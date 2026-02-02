const express = require("express");
const router = express.Router();
const Users = require("../Controllers/Users");
const { verifyToken } = require("../Utils/generateToken");

router.post("/Login", Users.loginOrSignup);
router.post("/UserSession", verifyToken,Users.updateSession);
router.post("/Update", verifyToken,Users.updateProfile);
router.post("/active-game", verifyToken,Users.getUserActiveGame);

module.exports = router;
