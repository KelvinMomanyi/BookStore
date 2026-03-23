const cloudinary = require('cloudinary').v2;
cloudinary.config({ cloud_name: 'dsmz1lxlk', api_key: '535578689954172', api_secret: '8-3OZ4VMIBTpH79Hnb8TTCnNPH8' });
const url = cloudinary.url('km6efxrgnyzoqqn5eujd.pdf', { sign_url: true, resource_type: 'image' });
console.log('SDK Signed URL:', url);
// Also test forced attachment download url
const url2 = cloudinary.url('km6efxrgnyzoqqn5eujd.pdf', { sign_url: true, resource_type: 'image', flags: 'attachment' });
console.log('SDK Attachment URL:', url2);

async function run() {
  let r1 = await fetch(url);
  console.log('URL1 STATUS:', r1.status, r1.headers.get('x-cld-error'));
  let r2 = await fetch(url2);
  console.log('URL2 STATUS:', r2.status, r2.headers.get('x-cld-error'));
}
run();
