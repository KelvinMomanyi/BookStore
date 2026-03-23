import crypto from 'crypto';
const targetStr = 'https://res.cloudinary.com/dsmz1lxlk/image/upload/v1773392051/km6efxrgnyzoqqn5eujd.pdf';
const target = new URL(targetStr);
const secret = '8-3OZ4VMIBTpH79Hnb8TTCnNPH8';

// path to sign: fl_attachment/km6efxrgnyzoqqn5eujd.pdf
const stringToSign = 'fl_attachment/km6efxrgnyzoqqn5eujd.pdf';
const sigHash = crypto.createHash('sha1').update(stringToSign + secret).digest('base64');
const sig = sigHash.replace(/\+/g, '-').replace(/\//g, '_').substring(0, 8);

const signedUrl = `https://res.cloudinary.com/dsmz1lxlk/image/upload/s--${sig}--/fl_attachment/v1773392051/km6efxrgnyzoqqn5eujd.pdf`;
console.log('signedUrl:', signedUrl);

fetch(signedUrl).then(async r => {
  console.log('STATUS:', r.status);
  console.log('HEADERS:', [...r.headers.entries()]);
  console.log('BODY:', await r.text());
}).catch(console.error);
