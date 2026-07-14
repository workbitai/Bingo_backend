/**
 * Get avatar path by avatar id
 * @param {number} avatarId (1–7)
 * @returns {string}
 */
function getAvatarById(avatarId) {
  const avatars = {
    1: "assets/Avatars/avatar1.webp",
    2: "assets/Avatars/avatar2.webp",
    3: "assets/Avatars/avatar3.webp",
    4: "assets/Avatars/avatar4.webp",
    5: "assets/Avatars/avatar5.webp",
    6: "assets/Avatars/avatar6.webp",
    7: "assets/Avatars/avatar7.webp"
  };

  // Default avatar if wrong or missing id
  return avatars[avatarId] || "assets/Avatars/avatar1.webp";
}

module.exports = getAvatarById;
