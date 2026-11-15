import forge from 'node-forge';
import {Buffer} from 'buffer';
import signpdfMod from '@signpdf/signpdf';
import {P12Signer} from '@signpdf/signer-p12';
import {pdflibAddPlaceholder} from '@signpdf/placeholder-pdf-lib';
import {SUBFILTER_ETSI_CADES_DETACHED, SUBFILTER_ADOBE_PKCS7_DETACHED} from '@signpdf/utils';
window.Buffer = window.Buffer || Buffer;
const signpdf = signpdfMod.default || signpdfMod;
window.PdfSig = {
  forge, Buffer, signpdf, P12Signer, pdflibAddPlaceholder, SUBFILTER_ETSI_CADES_DETACHED, SUBFILTER_ADOBE_PKCS7_DETACHED,
  async createSelfSigned({name, org, email, days}){
    const keys = await new Promise((res, rej) => forge.pki.rsa.generateKeyPair({bits: 2048, workers: -1}, (e, k) => e ? rej(e) : res(k)));
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
    cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + (days || 1095) * 86400000);
    const attrs = [{name: 'commonName', value: name}]; if (org) attrs.push({name: 'organizationName', value: org}); attrs.push({name: 'countryName', value: 'IT'});
    if (email) attrs.push({name: 'emailAddress', value: email});
    cert.setSubject(attrs); cert.setIssuer(attrs);
    cert.setExtensions([{name: 'basicConstraints', cA: false}, {name: 'keyUsage', digitalSignature: true, nonRepudiation: true}]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return {keys, cert};
  },
  toP12Bytes(keys, cert, password){
    const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {algorithm: '3des', generateLocalKeyId: true, friendlyName: 'Lettore PDF'});
    const der = forge.asn1.toDer(asn1).getBytes(); const u = new Uint8Array(der.length); for (let i = 0; i < der.length; i++) u[i] = der.charCodeAt(i); return u;
  }
};
