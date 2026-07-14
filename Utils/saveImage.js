const fs = require("fs");
const path = require("path");

function saveImage(base64, folderName, username, user_id) {
  if (!base64 || !username || !user_id) return null;

  // Clean username (spaces & special chars remove)
  const safeUsername = username.replace(/\s+/g, "_").toLowerCase();

  // Folder: assets/Users/<user_id>
  const folderPath = path.join(__dirname, "../assets", folderName, user_id);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  // File name: username_userid.webp
  const fileName = `${safeUsername}_${user_id}.webp`;
  const filePath = path.join(folderPath, fileName);

  // Remove base64 prefix
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, "");

  // Save file
  fs.writeFileSync(filePath, base64Data, "base64");

  // Return relative DB path
  return `assets/${folderName}/${user_id}/${fileName}`;
}

module.exports = saveImage;
