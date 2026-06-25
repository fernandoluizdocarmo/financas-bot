const { DB } = require('../bot.js');

module.exports = async (req, res) => {
  let total = 0;
  let pending = 0;
  try {
    const subs = await DB.allSubscribers();
    const pends = await DB.allPending();
    total = subs.length;
    pending = pends.length;
  } catch (e) {
    console.error('Error fetching subscribers:', e);
  }

  res.status(200).json({
    status: 'ok',
    subscribers: total,
    pending
  });
};
