const { DateTime } = require("luxon");

const INDIA_ZONE = "Asia/Kolkata";

const getNowIndia = () => {
  return DateTime.now().setZone(INDIA_ZONE);
};


const getContestDay = (startDate) => {

  const now = getNowIndia().startOf("day");

  const start = DateTime
    .fromJSDate(new Date(startDate))
    .setZone(INDIA_ZONE)
    .startOf("day");

  const difference =
    Math.floor(
      now.diff(start, "days").days
    );

  return difference + 1;
};


const getDailyWindow = (contest) => {

  const now = getNowIndia();

  const start = now.set({
    hour: contest.dailyStartHour,
    minute: contest.dailyStartMinute,
    second: 0,
    millisecond: 0,
  });

  const end = start.plus({
    minutes: contest.durationMinutes,
  });

  return {
    start,
    end,
    now,
  };
};


const isContestTime = (contest) => {

  const {
    start,
    end,
    now,
  } = getDailyWindow(contest);

  return (
    now >= start &&
    now < end
  );
};


module.exports = {
  getNowIndia,
  getContestDay,
  getDailyWindow,
  isContestTime,
};