import { test } from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUrl,isPublicIp,assertPublicUrl} from '../lib.mjs';

test('normalizes pasted URLs and drops fragments',()=>{
 assert.equal(normalizeUrl('example.com/a#section'),'https://example.com/a');
 assert.equal(normalizeUrl(' https://example.com/ '),'https://example.com/');
 for (const input of ['','file:///etc/passwd','ftp://example.com','https://user:pass@example.com']) assert.throws(()=>normalizeUrl(input));
});
test('rejects local, private, metadata, mapped and multicast addresses',()=>{
 for (const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','172.31.255.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.1.1.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1']) assert.equal(isPublicIp(ip),false,ip);
 for (const ip of ['1.1.1.1','8.8.8.8','172.32.0.1','2606:4700:4700::1111']) assert.equal(isPublicIp(ip),true,ip);
});
test('blocks alternative representations of loopback and unusual ports',async()=>{
 for (const input of ['http://2130706433','http://0x7f000001','http://127.1','http://[::1]','http://1.1.1.1:8080']) await assert.rejects(assertPublicUrl(input));
});
