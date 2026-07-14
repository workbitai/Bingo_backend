const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;

// --- TOKEN GENERATE ---
function generateToken(user) {
  // Permanent token (No expiry)
  return jwt.sign(
    {
      user_id: user.user_id,
      username: user.username
    },
    JWT_SECRET
  );
}

// --- TOKEN VERIFY ---
const verifyToken = (req, res, next) => {
  // console.log("req",req.headers)
  
  const authHeader = req.headers["authorization"];
  // console.log("authHeader",authHeader)
  const token = authHeader && authHeader.split(" ")[1];
  // console.log("token",token)
  if (!token) {
    return res.status(401).json({ 
        success: false, 
        message: "Access Denied: No Token Provided" 
    });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified; 

    // Match check: Token ki ID aur Request ki ID same honi chahiye
    const requestUserId = req.body.user_id || req.query.user_id;

    if (requestUserId && req.user.user_id.toString() !== requestUserId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: "Unauthorized: Token user_id does not match request user_id" 
      });
    }

    next(); 
  } catch (error) {
    return res.status(400).json({ success: false, message: "Invalid Token" });
  }
};

module.exports = { verifyToken, generateToken };