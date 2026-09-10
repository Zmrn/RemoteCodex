"""One-time, explicitly authorized GitHub signing setup. No plaintext secret files."""
import argparse, base64, json, os, subprocess, sys, urllib.request, urllib.error
from pathlib import Path
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.serialization import pkcs12
from nacl.public import PublicKey, SealedBox

ROOT = Path(__file__).resolve().parents[1]
REPO = 'Zmrn/RemoteCodex'
ENVIRONMENT = 'signing'

def token():
    value = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if value: return value
    result = subprocess.run(['git', '-c', 'credential.interactive=false', 'credential', 'fill'], cwd=ROOT,
        input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, check=True,
        env=dict(os.environ, GCM_INTERACTIVE='never'), creationflags=subprocess.CREATE_NO_WINDOW)
    for line in result.stdout.splitlines():
        if line.startswith('password='): return line[9:]
    raise RuntimeError('GitHub authentication unavailable; use an existing authenticated Windows user')

def unseal(file, field):
    saved = json.loads(file.read_text(encoding='utf-8-sig'))
    result = subprocess.run([sys.executable, str(ROOT/'src/win_secret.py')],
        input=json.dumps({'value':saved[field], 'operation':'unprotect'}),
        text=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode: raise RuntimeError('Original signing material cannot be decrypted by this Windows user')
    return json.loads(result.stdout)['value']

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Only after explicit permission to store original signing material on GitHub')
    args = parser.parse_args()
    container = (ROOT/'data/android-signing.p12').read_bytes()
    password = unseal(ROOT/'data/android-signing-password.json', 'sealedPassword')
    pem = unseal(ROOT/'data/release-signing-key.json', 'sealedPrivateKey')
    private = serialization.load_pem_private_key(pem.encode(), password=None)
    public = serialization.load_pem_public_key((ROOT/'src/update-public-key.pem').read_bytes())
    der = lambda key: key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    if der(private.public_key()) != der(public): raise RuntimeError('Original update signing identity mismatch')
    android_key, certificate, _ = pkcs12.load_key_and_certificates(container, password.encode())
    if android_key is None or certificate is None: raise RuntimeError('Original Android signing identity incomplete')
    fingerprint = certificate.fingerprint(hashes.SHA256()).hex()
    auth = token()
    def api(route, method='GET', body=None, allow404=False):
        request = urllib.request.Request('https://api.github.com/repos/'+REPO+'/'+route, method=method,
            data=None if body is None else json.dumps(body).encode(), headers={
            'User-Agent':'RemoteCodex-Signing-Setup', 'Authorization':'Bearer '+auth,
            'Accept':'application/vnd.github+json', 'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read(); return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            if allow404 and error.code == 404: return None
            raise RuntimeError('GitHub API '+str(error.code)+' for '+route) from None
    env_path = 'environments/'+ENVIRONMENT
    env = api(env_path, allow404=True)
    names = ['REMOTE_CODEX_ANDROID_KEYSTORE_BASE64', 'REMOTE_CODEX_ANDROID_KEYSTORE_PASSWORD', 'REMOTE_CODEX_UPDATE_PRIVATE_KEY_PEM']
    if not args.apply:
        print(json.dumps({'ready':True, 'applied':False, 'repository':REPO, 'environment':ENVIRONMENT,
                          'environmentExists':env is not None, 'androidCertificateSha256':fingerprint,
                          'secretNames':names, 'updatePublicKeyMatches':True}))
        return
    if env is None:
        env = api(env_path, 'PUT', {'deployment_branch_policy':{'protected_branches':False,'custom_branch_policies':True}})
    policy = env.get('deployment_branch_policy') or {}
    if policy.get('protected_branches') or not policy.get('custom_branch_policies'):
        raise RuntimeError('Existing signing environment has a different branch policy; left unchanged')
    policies = api(env_path+'/deployment-branch-policies')['branch_policies']
    if any(p['name'] != 'main' or p.get('type','branch') != 'branch' for p in policies):
        raise RuntimeError('Existing signing environment permits additional refs; left unchanged')
    if not policies: api(env_path+'/deployment-branch-policies','POST',{'name':'main','type':'branch'})
    public_key = api(env_path+'/secrets/public-key')
    box = SealedBox(PublicKey(base64.b64decode(public_key['key'], validate=True)))
    for name, value in zip(names, [base64.b64encode(container).decode(), password, pem]):
        encrypted = base64.b64encode(box.encrypt(value.encode())).decode()
        api(env_path+'/secrets/'+name,'PUT',{'key_id':public_key['key_id'],'encrypted_value':encrypted})
    variables = {'REMOTE_CODEX_ANDROID_CERT_SHA256':fingerprint}
    for name, value in variables.items():
        current = api(env_path+'/variables/'+name, allow404=True)
        api(env_path+'/variables'+('/'+name if current else ''), 'PATCH' if current else 'POST', {'name':name,'value':value})
    configured = api(env_path+'/secrets')['secrets']
    if not set(names).issubset(s['name'] for s in configured): raise RuntimeError('Signing secret metadata verification failed')
    print(json.dumps({'applied':True,'repository':REPO,'environment':ENVIRONMENT,'branch':'main',
                      'secretNames':names,'variableNames':list(variables),'androidCertificateSha256':fingerprint,
                      'updatePublicKeyMatches':True,'plaintextFilesWritten':False,'loginCredentialsExported':False}))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        # Never dump exceptions that could include subprocess stdin or secret values.
        print(str(error) if isinstance(error, RuntimeError) else 'Signing setup failed: '+type(error).__name__, file=sys.stderr)
        sys.exit(1)
