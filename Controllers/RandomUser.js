const RandomUser = require("../Models/RandomUser");
const path = require("path");
const fs = require("fs");
module.exports = {

    // INSERT
    insert: async (req, res) => {
        try {
            const { username, avatar } = req.body;

            if (!username || !avatar) {
                return res.status(400).json({
                    status: false,
                    message: "username and avatar are required"
                });
            }

            const user = await RandomUser.create({ username, avatar });

            return res.json({
                status: true,
                message: "User inserted",
                data: user
            });

        } catch (err) {
            return res.status(500).json({
                status: false,
                message: err.message
            });
        }
    },

    // UPDATE (id from body)
    update: async (req, res) => {
        try {
            const { id, username, avatar } = req.body;

            if (!id) return res.status(400).json({ status: false, message: "id is required" });

            const updated = await RandomUser.findByIdAndUpdate(
                id,
                { username, avatar },
                { new: true }
            );

            if (!updated) return res.json({ status: false, message: "User not found" });

            return res.json({
                status: true,
                message: "User updated",
                data: updated
            });

        } catch (err) {
            return res.status(500).json({ status: false, message: err.message });
        }
    },

    // DELETE
    delete: async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ status: false, message: "id is required" });

            const deleted = await RandomUser.findByIdAndDelete(id);
            if (!deleted) return res.json({ status: false, message: "User not found" });

            return res.json({ status: true, message: "User deleted" });

        } catch (err) {
            return res.status(500).json({ status: false, message: err.message });
        }
    },

    // SELECT ALL
    selectAll: async (req, res) => {
        try {
            const users = await RandomUser.find().sort({ createdAt: -1 });

            return res.json({ status: true, data: users });

        } catch (err) {
            return res.status(500).json({ status: false, message: err.message });
        }
    },

    // SELECT BY ID
    selectById: async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ status: false, message: "id is required" });

            const user = await RandomUser.findById(id);
            if (!user) return res.json({ status: false, message: "User not found" });

            return res.json({ status: true, data: user });

        } catch (err) {
            return res.status(500).json({ status: false, message: err.message });
        }
    },

    // SELECT RANDOM USER
    selectRandom: async (req, res) => {
        try {
            const users = await RandomUser.aggregate([{ $sample: { size: 1 } }]);
            return res.json({ status: true, data: users[0] || null });
        } catch (err) {
            return res.status(500).json({ status: false, message: err.message });
        }
    },
    insertBulk: async (req, res) => {
        try {
            const names = [
              
//   "Aanya", "Ananya", "Diya", "Kavya", "Ishita",
//   "Priya", "Riya", "Saanvi", "Avni", "Myra",
//   "Kiara", "Nisha", "Sneha", "Shreya", "Tanvi",
//   "Anjali", "Neha", "Ira", "Meera", "Aditi",
//   "Bhavya", "Sakshi", "Komal", "Simran", "Pallavi",
//   "Emma", "Olivia", "Sophia", "Isabella", "Mia",
//   "Charlotte", "Amelia", "Ava", "Harper", "Evelyn",
//   "Scarlett", "Grace", "Chloe", "Lily", "Aria",
//   "Layla", "Aurora", "Nora", "Stella", "Hazel",
//   "Violet", "Ruby", "Alice", "Clara", "Elena",
//   "Zara", "Tara", "Navya", "Jiya", "Khushi",
//   "Saanvika", "Radhika", "Nandini", "Pihu", "Isha",
//   "Sara", "Fatima", "Ayesha", "Lina", "Nina",
//   "Sofia", "Laylaa", "Eliza", "Julia", "Mila",
//   "Naomi", "Gabriella", "Valentina", "Adeline", "Amaya",
//   "Bianca", "Freya", "Phoebe", "Daisy", "Rosie",
//   "Willow", "Ariana", "Bella", "Madison", "Sienna",
//   "Cora", "Athena", "Luna", "Rose", "Esha",
//   "Vanya", "Pari", "Kriti", "Aarohi", "Samaira"


  "Aarav", "Vivaan", "Aditya", "Arjun", "Kabir",
  "Rohan", "Krishna", "Yash", "Om", "Dev",
  "Shaurya", "Ishaan", "Ritvik", "Vihaan", "Karan",
  "Aryan", "Lakshya", "Atharv", "Rudra", "Parth",
  "Harsh", "Nikhil", "Raghav", "Shivansh", "Aniket",
  "Devansh", "Ayaan", "Manav", "Pranav", "Tanmay",
  "Siddharth", "Yuvraj", "Ansh", "Dhruv", "Arnav",
  "Rishi", "Shiv", "Ronit", "Aman", "Ankit",
  "Rahul", "Amit", "Rohit", "Vishal", "Jay",
  "Krish", "Laksh", "Yug", "Samar", "Omkar",
  "Liam", "Noah", "Oliver", "Elijah", "James",
  "William", "Benjamin", "Lucas", "Henry", "Alexander",
  "Mason", "Michael", "Ethan", "Daniel", "Jacob",
  "Logan", "Jackson", "Levi", "Sebastian", "Mateo",
  "Jack", "Owen", "Theodore", "Aiden", "Samuel",
  "Joseph", "John", "David", "Ryan", "Adrian",
  "Miles", "Roman", "Nolan", "Evan", "Jordan",
  "Dominic", "Xavier", "Ian", "Adam", "Jason",
  "Cooper", "Brody", "Declan", "Finn", "Gavin",
  "Blake", "Parker", "Griffin", "Leon", "Beau"
];
            

            const users = [];

            const allowedAvatars = [0,2,3];

            for (let i = 0; i < names.length; i++) {
                // Array se random index pick karein (0, 1, ya 2)
                const randomIndex = Math.floor(Math.random() * allowedAvatars.length);

                // Array se value nikaalein (1, 2, ya 6 milega)
                const avatar = allowedAvatars[randomIndex];

                users.push({
                    username: names[i],
                    avatar: avatar
                });
            }

            // Insert all users at once
            const inserted = await RandomUser.insertMany(users);

            return res.json({
                status: true,
                message: "100 users inserted successfully",
                data: inserted
            });

        } catch (err) {
            return res.status(500).json({
                status: false,
                message: err.message
            });
        }
    }
//     insertBulk: async (req, res) => {
//     try {
//        const names = [
//     "Aanya",
//     "Ananya",
//     "Diya",
//     "Kavya",
//     "Ishita",
//     "Pooja",
//     "Priya",
//     "Riya",
//     "Saanvi",
//     "Avni",
//     "Myra",
//     "Kiara",
//     "Nisha",
//     "Sneha",
//     "Shreya",
//     "Tanvi",
//     "Anjali",
//     "Neha",
//     "Swati",
//     "Payal",
//     "Ira",
//     "Meera",
//     "Aditi",
//     "Bhavya",
//     "Rashmi",
//     "Sakshi",
//     "Komal",
//     "Simran",
//     "Pallavi",
//     "Kritika",
//     "Anaya",
//     "Tara",
//     "Nandini",
//     "Radhika",
//     "Navya",
//     "Jiya",
//     "Khushi"
// ];

//         const users = [];

//         const assetFolder = path.join(__dirname, "../assets");

//         // 191 to 228 image list
//         const imageNumbers = [];
//         for (let i = 191; i <= 228; i++) {
//             imageNumbers.push(i);
//         }

//         for (let i = 0; i < names.length; i++) {
//             const randomImageNo =
//                 imageNumbers[Math.floor(Math.random() * imageNumbers.length)];

//             // Find file with any extension
//             const file = fs.readdirSync(assetFolder).find((f) =>
//                 path.parse(f).name === String(randomImageNo)
//             );

//             users.push({
//                 username: names[i],
//                 profile_pic: file
//                     ? `/assets/${file}` // e.g. 191.jpg
//                     : null
          
//             });
//         }

//         const inserted = await RandomUser.insertMany(users);

//         return res.json({
//             status: true,
//             message: `${inserted.length} users inserted successfully`,
//             data: inserted
//         });

//     } catch (err) {
//         return res.status(500).json({
//             status: false,
//             message: err.message
//         });
//     }
// }
//     insertBulk: async (req, res) => {
//     try {
//        const names = [
//     "Aanya",
//     "Ananya",
//     "Diya",
//     "Kavya",
//     "Ishita",
//     "Pooja",
//     "Priya",
//     "Riya",
//     "Saanvi",
//     "Avni",
//     "Myra",
//     "Kiara",
//     "Nisha",
//     "Sneha",
//     "Shreya",
//     "Tanvi",
//     "Anjali",
//     "Neha",
//     "Swati",
//     "Payal",
//     "Ira",
//     "Meera",
//     "Aditi",
//     "Bhavya",
//     "Rashmi",
//     "Sakshi",
//     "Komal",
//     "Simran",
//     "Pallavi",
//     "Kritika",
//     "Anaya",
//     "Tara",
//     "Nandini",
//     "Radhika",
//     "Navya",
//     "Jiya",
//     "Khushi"
// ];

//         const users = [];

//         const assetFolder = path.join(__dirname, "../assets");

//         // 191 to 228 image list
//         const imageNumbers = [];
//         for (let i = 191; i <= 228; i++) {
//             imageNumbers.push(i);
//         }

//         for (let i = 0; i < names.length; i++) {
//             const randomImageNo =
//                 imageNumbers[Math.floor(Math.random() * imageNumbers.length)];

//             // Find file with any extension
//             const file = fs.readdirSync(assetFolder).find((f) =>
//                 path.parse(f).name === String(randomImageNo)
//             );

//             users.push({
//                 username: names[i],
//                 profile_pic: file
//                     ? `/assets/${file}` // e.g. 191.jpg
//                     : null
          
//             });
//         }

//         const inserted = await RandomUser.insertMany(users);

//         return res.json({
//             status: true,
//             message: `${inserted.length} users inserted successfully`,
//             data: inserted
//         });

//     } catch (err) {
//         return res.status(500).json({
//             status: false,
//             message: err.message
//         });
//     }
// }

//    insertBulk: async (req, res) => {
//     try {
//        const names = [
// //     "Aanya", "Ananya",
// //   "Bhavya", "Bindiya",
// //   "Charvi", "Chandni",
// //   "Diya", "Divya",
// //   "Esha", "Ekta",
// //   "Falak", "Falguni",
// //   "Gauri", "Gunjan",
// //   "Hina", "Harini",
// //   "Ira", "Ishita",
// //   "Jiya", "Juhi",
// //   "Kavya", "Khushi",
// //   "Lavanya", "Lisha",
// //   "Myra", "Meera",
// //   "Nandini", "Navya",
// //   "Oviya", "Oorja",
// //   "Pooja", "Payal",
// //   "Qiana", "Qurat",
// //   "Riya", "Rashmi",
// //   "Sneha", "Saanvi",
// //   "Tanvi", "Tara",
// //   "Urvi", "Uma",
// //   "Vaishnavi", "Vidhi",
// //   "Wamika", "Wisha",
// //   "Xena", "Xiya",
// //   "Yamini", "Yuvika",
// //   "Zara", "Zoya"



// //   "Aarav", "Aryan",
// //   "Bhavesh", "Bharat",
// //   "Chirag", "Chetan",
// //   "Dhruv", "Dev",
// //   "Eshan", "Ekansh",
// //   "Farhan", "Faiz",
// //   "Gaurav", "Girish",
// //   "Harsh", "Himansh",
// //   "Ishaan", "Indrajit",
// //   "Jay", "Jatin",
// //   "Kabir", "Krish",
// //   "Laksh", "Lokesh",
// //   "Manav", "Mohit",
// //   "Nikhil", "Nirav",
// //   "Om", "Ojas",
// //   "Parth", "Pranav",
// //   "Qasim", "Qadir",
// //   "Rohan", "Rudra",
// //   "Samar", "Shaurya",
// //   "Tanmay", "Tushar",
// //   "Uday", "Utkarsh",
// //   "Vivaan", "Vedant",
// //   "Wasim", "Wajid",
// //   "Xavier", "Xander",
// //   "Yash", "Yug",
// //   "Zayan", "Zubair"
// ];

//         const users = [];

//         const assetFolder = path.join(__dirname, "../assets");

//         // 191 to 228 image list
//         const imageNumbers = [];
//         for (let i = 229; i <= 280; i++) {
//             imageNumbers.push(i);
//         }

//         for (let i = 0; i < names.length; i++) {
//             const randomImageNo = imageNumbers[i]; 

//             // Find file with any extension
//             const file = fs.readdirSync(assetFolder).find((f) =>
//                 path.parse(f).name === String(randomImageNo)
//             );

//             users.push({
//                 username: names[i],
//                 profile_pic: file
//                     ? `/assets/${file}` // e.g. 191.jpg
//                     : null
          
//             });
//         }

//         const inserted = await RandomUser.insertMany(users);

//         return res.json({
//             status: true,
//             message: `${inserted.length} users inserted successfully`,
//             data: inserted
//         });

//     } catch (err) {
//         return res.status(500).json({
//             status: false,
//             message: err.message
//         });
//     }
// }

//     insertBulk: async (req, res) => {
//     try {
//        const names = [
// //     "Emma", "Olivia", "Sophia", "Isabella", "Mia",
// //   "Charlotte", "Amelia", "Harper", "Evelyn", "Abigail",
// //   "Emily", "Ella", "Scarlett", "Grace", "Chloe",
// //   "Victoria", "Lily", "Hannah", "Zoe", "Nora",
// //   "Stella", "Lucy", "Aria", "Layla", "Aurora",
// //   "Natalie", "Leah", "Hazel", "Violet", "Ruby",
// //   "Alice", "Claire", "Anna", "Julia", "Elena",
// //   "Madison", "Bella", "Naomi", "Samantha", "Sarah",
// //   "Eva", "Mila", "Ariana", "Gabriella", "Savannah",
// //   "Allison", "Eliza", "Sadie", "Autumn", "Willow",
// //   "Penelope", "Brooklyn", "Paisley", "Aubrey", "Skylar",
// //   "Camila", "Genesis", "Madelyn", "Serenity", "Kennedy",
// //   "Valentina", "Caroline", "Aaliyah", "Kinsley", "Delilah",
// //   "Vivian", "Adeline", "Clara", "Raelynn", "Melanie",
// //   "Melody", "Jade", "Athena", "Maria", "Faith",
// //   "Rose", "Margaret", "Luna", "Isla", "Cora",
// //   "Freya", "Phoebe", "Daisy", "Sienna", "Rosalie",
// //   "Valerie", "Bianca"


//  "Liam", "Noah", "Oliver", "Elijah", "James",
//   "William", "Benjamin", "Lucas", "Henry", "Alexander",
//   "Mason", "Michael", "Ethan", "Daniel", "Jacob",
//   "Logan", "Jackson", "Levi", "Sebastian", "Mateo",
//   "Jack", "Owen", "Theodore", "Aiden", "Samuel",
//   "Joseph", "John", "David", "Wyatt", "Matthew",
//   "Luke", "Asher", "Carter", "Julian", "Grayson",
//   "Leo", "Jayden", "Gabriel", "Isaac", "Lincoln",
//   "Anthony", "Hudson", "Dylan", "Ezra", "Thomas",
//   "Charles", "Christopher", "Jaxon", "Maverick", "Josiah",
//   "Andrew", "Elias", "Nathan", "Caleb", "Ryan",
//   "Adrian", "Miles", "Roman", "Hunter", "Colton",
//   "Nolan", "Christian", "Aaron", "Santiago", "Axel",
//   "Evan", "Jordan", "Dominic", "Xavier", "Ian",
//   "Adam", "Brayden", "Jason", "Cooper", "Easton",
//   "Weston", "Jace", "Carson", "Micah", "Robert",
//   "Maxwell", "Vincent", "Jasper", "Sawyer", "Brody",
//   "Declan", "Emmett", "Finn", "Gavin", "Tristan",
//   "Blake", "Bennett", "Parker", "Griffin", "Leon",
//   "Beau", "Tucker", "Reid", "Ryder", "Kingston"
// ];

//         const users = [];

//         const assetFolder = path.join(__dirname, "../assets");

//         // 191 to 228 image list
//         const imageNumbers = [];
//         for (let i = 1; i <= 103; i++) {
//             imageNumbers.push(i);
//         }

//         for (let i = 0; i < names.length; i++) {
//             const randomImageNo =
//                 imageNumbers[Math.floor(Math.random() * imageNumbers.length)];

//             // Find file with any extension
//             const file = fs.readdirSync(assetFolder).find((f) =>
//                 path.parse(f).name === String(randomImageNo)
//             );

//             users.push({
//                 username: names[i],
//                 profile_pic: file
//                     ? `/assets/${file}` // e.g. 191.jpg
//                     : null
          
//             });
//         }

//         const inserted = await RandomUser.insertMany(users);

//         return res.json({
//             status: true,
//             message: `${inserted.length} users inserted successfully`,
//             data: inserted
//         });

//     } catch (err) {
//         return res.status(500).json({
//             status: false,
//             message: err.message
//         });
//     }
// }
};
