const dotenv = require("dotenv");
const mongoose = require("mongoose");

const connectDB =
  require("./config/db");

const Contest =
  require("./models/Contest");

const Question =
  require("./models/Question");


dotenv.config();


const questions = [

  // DAY 1

  {
    day: 1,
    question:
      "Which organelle is known as the powerhouse of the cell?",
    options: [
      "Nucleus",
      "Mitochondria",
      "Ribosome",
      "Golgi body",
    ],
    answer: "Mitochondria",
  },

  {
    day: 1,
    question:
      "What is the basic unit of life?",
    options: [
      "Tissue",
      "Organ",
      "Cell",
      "Atom",
    ],
    answer: "Cell",
  },

  {
    day: 1,
    question:
      "Which molecule carries genetic information?",
    options: [
      "ATP",
      "DNA",
      "Glucose",
      "Protein",
    ],
    answer: "DNA",
  },

  {
    day: 1,
    question:
      "Which gas is mainly used by humans for respiration?",
    options: [
      "Nitrogen",
      "Oxygen",
      "Carbon dioxide",
      "Hydrogen",
    ],
    answer: "Oxygen",
  },

  {
    day: 1,
    question:
      "Which blood cells help fight infections?",
    options: [
      "RBC",
      "WBC",
      "Platelets",
      "Plasma",
    ],
    answer: "WBC",
  },


  // DAY 2

  {
    day: 2,
    question:
      "Which part of the plant performs photosynthesis?",
    options: [
      "Root",
      "Leaf",
      "Stem",
      "Flower",
    ],
    answer: "Leaf",
  },

  {
    day: 2,
    question:
      "What is the SI unit of force?",
    options: [
      "Joule",
      "Newton",
      "Watt",
      "Pascal",
    ],
    answer: "Newton",
  },

  {
    day: 2,
    question:
      "Which vitamin is produced in the skin by sunlight?",
    options: [
      "Vitamin A",
      "Vitamin B",
      "Vitamin C",
      "Vitamin D",
    ],
    answer: "Vitamin D",
  },

  {
    day: 2,
    question:
      "Which organ pumps blood through the body?",
    options: [
      "Liver",
      "Heart",
      "Kidney",
      "Lung",
    ],
    answer: "Heart",
  },

  {
    day: 2,
    question:
      "What is the chemical symbol for oxygen?",
    options: [
      "O",
      "Ox",
      "C",
      "H",
    ],
    answer: "O",
  },

];


// Add more questions for Day 3-7.
// Exactly 5 questions per day.

const seed = async () => {

  try {

    await connectDB();


    await Contest.deleteMany({});

    await Question.deleteMany({});


    const contest =
      await Contest.create({

        title:
          "NEET 7 Day Challenge",

        description:
          "A seven day NEET practice contest",

        price: 99,

        startDate:
          new Date(
            `${process.env.CONTEST_START_DATE}T00:00:00+05:30`
          ),

        totalDays: 7,

        dailyQuestionCount: 5,

        durationMinutes: 30,

        dailyStartHour: 20,

        dailyStartMinute: 0,

      });


    const questionDocuments =
      questions.map(
        (item) => ({

          contestId:
            contest._id,

          dayNumber:
            item.day,

          question:
            item.question,

          options:
            item.options,

          correctAnswer:
            item.answer,

          marks: 1,

        })
      );


    await Question.insertMany(
      questionDocuments
    );


    console.log(
      "Contest created:"
    );

    console.log(
      contest._id.toString()
    );

    console.log(
      `Questions inserted: ${questionDocuments.length}`
    );


    process.exit(0);

  } catch (error) {

    console.log(error);

    process.exit(1);

  }

};


seed();