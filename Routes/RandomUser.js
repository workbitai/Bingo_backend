const express = require("express");
const router = express.Router();
const RandomUser = require("../Controllers/RandomUser");

router.post("/Insert", RandomUser.insert);
router.post("/Update", RandomUser.update);
router.post("/Delete", RandomUser.delete);
router.post("/Select", RandomUser.selectAll);
router.post("/Select-by-id", RandomUser.selectById);
router.post("/Select-random", RandomUser.selectRandom);
router.post("/InsertBulk", RandomUser.insertBulk);

module.exports = router;