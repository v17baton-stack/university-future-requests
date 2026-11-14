import readline from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {readLocal,writeLocal} from './local-env.mjs';
// Fallback owner verification: the person obtains THEIR OWN ID via /id in the
// already-connected private bot, then explicitly confirms that value here.
// No getUpdates, no local requests to api.telegram.org, no first-visitor owner.
const env=readLocal();
if(!env.BOT_USERNAME)throw Error('Сначала укажите BOT_USERNAME собственного бота.');
const io=readline.createInterface({input:stdin,output:stdout});
try{
 console.log(`Откройте собственного бота @${env.BOT_USERNAME} после подключения webhook и отправьте /id. Не используйте ID из чужого сообщения.`);
 const id=(await io.question('Введите ID из ответа бота в вашем личном чате: ')).trim();
 if(!/^[1-9]\d{0,15}$/.test(id)||!Number.isSafeInteger(Number(id)))throw Error('Нужен положительный числовой ID.');
 const confirmation=(await io.question('Это ваш собственный аккаунт, который будет владельцем обращений? Введите ДА: ')).trim();
 if(confirmation!=='ДА')throw Error('Назначение владельца отменено.');
 writeLocal({ADMIN_CHAT_ID:id});console.log('ID владельца записан локально. Облачные секреты ещё нужно обновить; сам ID не является токеном доступа.');
}finally{io.close();}
