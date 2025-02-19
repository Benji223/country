import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import cron from 'node-cron';
import TelegramBot from 'node-telegram-bot-api';

puppeteer.use(StealthPlugin());
dotenv.config();

const email = process.env.EMAIL;
const password = process.env.PASSWORD;
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const bookingData = {
  day: '',
  hours: '',
  weekDay: '',
};


////////////// BOT MESSAGE //////////////

const mainKeyboard = {
  keyboard: [
    ['/book', '/start'],
  ],
  resize_keyboard: true,
};

const users = {};

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ];

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  users[chatId] = { state: 'idle' };
  bot.sendMessage(chatId, 'Welcome to the Country Club Booking Bot! How can I assist you today?', {
    reply_markup: JSON.stringify(mainKeyboard)
  });
});

bot.onText(/\/book/, (msg) => {
  const chatId = msg.chat.id;
  users[chatId] = { state: 'awaiting_day' };
  bot.sendMessage(chatId, 'Please enter the day you want to book (e.g., 27):');
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!users[chatId]) {
    users[chatId] = { state: 'idle' };
  }

  switch (users[chatId].state) {
    case 'awaiting_day':
      if (/^\d+$/.test(text)) {
        users[chatId].day = text;
        users[chatId].state = 'awaiting_hours';
        const hoursKeyboard = {
          keyboard: [
            ['18:00', '19:00'],
            ['20:00', '21:00'],
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        };
        bot.sendMessage(chatId, 'Great! Now select the time you want to book:', { reply_markup: JSON.stringify(hoursKeyboard) });
      } else {
        bot.sendMessage(chatId, 'Please enter a valid day (1-31).');
      }
      break;

    case 'awaiting_hours':
      if (/^\d{2}:\d{2}$/.test(text)) {
        users[chatId].hours = text;
        users[chatId].state = 'awaiting_dayOfBooking';
        const keyboard = {
          keyboard: dayNames.map((day, index) => [`${index + 1}. ${day}`]),
          resize_keyboard: true,
          one_time_keyboard: true
        };
        bot.sendMessage(chatId, 'Great! Now select the day of the week:', { reply_markup: JSON.stringify(keyboard) });
      } else {
        bot.sendMessage(chatId, 'Please enter a valid time in the format HH:MM.');
      }
      break;

      // case 'awaiting_hours':
      // if (/^\d{2}:\d{2}$/.test(text)) {
      //   users[chatId].hours = text;
      //   users[chatId].state = 'confirming';
      //   bot.sendMessage(chatId, `You want to book for the ${users[chatId].day} at ${users[chatId].hours}. Is this correct?`, {
      //           reply_markup: JSON.stringify({
      //             keyboard: [['✅ Yes', '❌ No']],
      //             resize_keyboard: true,
      //             one_time_keyboard: true
      //           })
      //         });
      //   bot.sendMessage(chatId, 'Great! Now select the day of the week:', { reply_markup: JSON.stringify(keyboard) });
      // } else {
      //   bot.sendMessage(chatId, 'Please enter a valid time in the format HH:MM.');
      // }
      // break;

    case 'awaiting_dayOfBooking':
      const dayIndex = parseInt(text.split('.')[0]) - 1;
      if (dayIndex >= 0 && dayIndex < 7) {
        users[chatId].weekDay = dayIndex ;
        users[chatId].state = 'confirming';
        const dayName = dayNames[dayIndex];
        bot.sendMessage(chatId, `You want to book on ${dayName} for the ${users[chatId].day} at ${users[chatId].hours}. Is this correct?`, {
          reply_markup: JSON.stringify({
            keyboard: [['✅ Yes', '❌ No']],
            resize_keyboard: true,
            one_time_keyboard: true
          })
        });
      } else {
        bot.sendMessage(chatId, 'Please select a valid day of the week.');
      }
      break;

    case 'confirming':
      if (text === '✅ Yes') {
        const bookingData = {
          day: users[chatId].day,
          hours: users[chatId].hours,
          weekDay: users[chatId].weekDay
        };
        multiStageLogin(email, password, bookingData, chatId);
        users[chatId].state = 'idle';
      } else if (text === '❌ No') {
        bot.sendMessage(chatId, 'Booking cancelled. Use /book to start over.');
        users[chatId].state = 'idle';
      } else {
        bot.sendMessage(chatId, 'Please answer with Yes or No.');
      }
      break;

    default:
      if (text !== '/start' && text !== '/book') {
        bot.sendMessage(chatId, 'I didn\'t understand that. Use /book to start a new booking.');
      }
  }
});

////////////// BOOK //////////////

async function multiStageLogin( email, password, bookingData, chatId) {
  bot.sendMessage(chatId, `Booking for the ${bookingData.day} at ${bookingData.hours} on ${bookingData.weekDay}th day of the week`);
  bot.sendMessage(chatId, 'booking will be processed at the right time');

  // minutes hours * * weekday
  cron.schedule(`00 00 * * ${bookingData.weekDay} ` , async () => {
    bot.sendMessage(chatId,'Starting login process...');

    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // headless: false,
      // slowMo: 20,
    });

    const page = await browser.newPage();

    try {
      bot.sendMessage(chatId,`Navigating to country`);
      await page.goto('https://countryclubbarrierelabaule.gestion-sports.com/connexion.php', { waitUntil: 'networkidle2' });

      await page.waitForSelector('input[name=email]', { visible: true });

      await page.type('input[name=email]', email, { delay: 30 });
      await page.click('.contact100-form-btn');

      await page.waitForSelector('input[name=pass]', { visible: true });
      await page.type('input[name=pass]', password, { delay: 30 });
      
      await Promise.all([
        // <button class="contact100-form-btn step-2_co show-partner" type="submit"> Se connecter</button>
        page.click('button.contact100-form-btn.step-2_co.show-partner'),
        page.waitForNavigation({ waitUntil: 'networkidle0' })
      ]);

      const loggedInText = await page.evaluate(() => document.body.innerText);
      if (loggedInText.includes('Bonjour Benjamin') ) {
        bot.sendMessage(chatId,'Login successful!');
      } else {
        throw new Error('Login failed');
      }

      //////////// BOOKING COURT //////////

      await Promise.all([
        page.click('a[href="/membre/reservation.html"]'),
        page.waitForNavigation({ waitUntil: 'networkidle2' })
      ]);
      bot.sendMessage(chatId,'Navigating to booking page...');

      await page.select('#sport', '778');
      bot.sendMessage(chatId,' tennis selected');

      ////////// TABLEAU //////////

      await page.waitForSelector('.datepicker', { visible: true });
      await page.type('.datepicker', '');
      bot.sendMessage(chatId,'calendar selected');


      ////////// DAY //////////

      await page.waitForSelector('#ui-datepicker-div > table > tbody ', { visible: true });

      await page.evaluate((bookingData) => {
        let date = bookingData.day;
        const day = document.querySelector(`[data-date="${date}"]`);
        if (day) {
          day.click();
        } else {
          throw new Error(`Day not found: ${date}`);
        }
      } ,bookingData);

      const dayFound = await page.evaluate((bookingData) => {
        let date = bookingData.day;
        const day = document.querySelector(`[data-date="${date}"]`);
        if (day) {
          day.click();
          return true;
        } else {
          return false;
        }
      }, bookingData);

      if (!dayFound) {
        bot.sendMessage(chatId, `Day not found: ${bookingData.day}`);
        throw new Error(`Day not found: ${bookingData.day}`);
      }

      bot.sendMessage(chatId,`Day ${bookingData.day} selected`);

      /////////// SELECT HOURS //////////

      await page.waitForSelector('#heure', { visible: true });
      await page.click('#heure');
      // await new Promise(resolve => setTimeout(resolve, 1000));
      await page.select('#heure', bookingData.hours);
      await page.click('#heure');

      bot.sendMessage(chatId,`Booking at ${bookingData.hours} .....`);


      /////////// SELECT COURT //////////

      await page.waitForSelector('#appCapsule > div.section.full.mt-2.mb-2.resaForm > form > div.row.pb-1.pt-2.group_court.insertContentCourt', { visible: true });
      
      const courtId = await page.evaluate((bookingData) => {
        const hours = bookingData.hours;
        // bot.sendMessage(chatId,`Searching for hours: ${hours}`);
      
        const courts = [
          { element: document.querySelector('[data-idcourt="2049"]'), id: "2049" },
          { element: document.querySelector('[data-idcourt="2051"]'), id: "2051" },
          { element: document.querySelector('[data-idcourt="2052"]'), id: "2052" }
        ];
      
        for (const court of courts) {
          console.log(`Checking court ${court.id}`);
          if (!court.element) {
            console.log(`Court ${court.id} element not found`);
            continue;
          }
      
          const buttons = Array.from(court.element.querySelectorAll('button'));
      
          const button = buttons.find(btn => {
            const btnText = btn.innerText.trim();
            return btnText === hours;
          });
      
          if (button) {
            button.click();
            return court.id;
          }
        }
      
        // bot.sendMessage(chatId,'No matching court hours found');
        return null;
      }, bookingData);
      
      bot.sendMessage(chatId,`Selected court ID: ${courtId}`);

      /////////// SUBMIT BOOKING //////////

      await page.waitForSelector(`#appCapsule > div.section.full.mt-2.mb-2.resaForm > form > div.row.pb-1.pt-2.group_court.insertContentCourt > div.bloccourt.court_${courtId}.col-md-4.col-sm-6.col-12.mb-2 > div > div > div.form-row > div > div.bloc_duree.hide.col-md-12 > div > button`, {visible: true});
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await page.click(`#appCapsule > div.section.full.mt-2.mb-2.resaForm > form > div.row.pb-1.pt-2.group_court.insertContentCourt > div.bloccourt.court_${courtId}.col-md-4.col-sm-6.col-12.mb-2 > div > div > div.form-row > div > div.bloc_duree.hide.col-md-12 > div > button`)

      bot.sendMessage(chatId,'Booking processing...');

      /////////// CONFIRM BOOKING //////////

      await page.waitForSelector('#btn_paiement_free_resa', { visible: true }, { timeout: 10000 });

      const buttonClicked = await page.evaluate(() => {
        const submitButton = document.querySelector('#btn_paiement_free_resa');
        if (submitButton) {
          submitButton.click();
          return true;
        } else {
          return false;
        }
      });

      if (!buttonClicked) {
        throw new Error('Submit button not found');
      }

      bot.sendMessage(chatId,'Booking successful!');
  
    } catch (error) {
      bot.sendMessage(chatId,'Booking failed:', error);
      await page.screenshot({ path: 'booking_failure.png' });
    } finally {
      await browser.close();
    }
});
}
