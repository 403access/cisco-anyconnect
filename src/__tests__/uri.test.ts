import {
  buildCallbackUrl,
  buildCloseUri,
  buildConnectUri,
  buildCreateConnectionUri,
  buildDisconnectUri,
  buildImportCertificateUri,
  buildImportProfileUri,
  buildLocalizeUri,
  encodeValue,
  parseCallbackUrl,
} from '../uri';

describe('encodeValue', () => {
  it('escapes reserved characters', () => {
    expect(encodeValue('10. Single Authentication')).toBe('10.%20Single%20Authentication');
  });

  it('keeps slashes and colons when asked to, so Group URLs survive', () => {
    expect(encodeValue('hr.example.com/group-url', { keepSlashes: true })).toBe(
      'hr.example.com/group-url'
    );
    expect(encodeValue('https://vpn.example.com/x', { keepSlashes: true })).toBe(
      'https://vpn.example.com/x'
    );
  });

  it('escapes slashes by default', () => {
    expect(encodeValue('a/b')).toBe('a%2Fb');
  });
});

describe('buildCreateConnectionUri', () => {
  it('matches the documented shape', () => {
    expect(buildCreateConnectionUri({ name: 'SimpleExample', host: 'vpn.example.com' })).toBe(
      'anyconnect://create/?name=SimpleExample&host=vpn.example.com'
    );
  });

  it('omits parameters that were not provided', () => {
    expect(buildCreateConnectionUri({ host: 'vpn.example.com' })).toBe(
      'anyconnect://create/?host=vpn.example.com'
    );
  });

  it('serialises protocol, certificate and on-demand options', () => {
    const uri = buildCreateConnectionUri({
      name: 'Corp IPsec',
      host: 'vpn.company.com',
      protocol: 'IPsec',
      authentication: 'EAP-MSCHAPv2',
      ikeIdentity: '012A4F8B29A9BCD',
      useCert: true,
      certCommonName: 'example-ID',
      netRoam: false,
      useOnDemand: true,
      domainListAlways: ['email.example.com', 'pay.examplecloud.com'],
      domainListIfNeeded: ['intranet.example.com'],
      domainListNever: ['www.example.com'],
    });

    expect(uri).toContain('protocol=IPsec');
    expect(uri).toContain('authentication=EAP-MSCHAPv2');
    expect(uri).toContain('ike-identity=012A4F8B29A9BCD');
    expect(uri).toContain('usecert=true');
    expect(uri).toContain('certcommonname=example-ID');
    expect(uri).toContain('netroam=false');
    expect(uri).toContain('useondemand=true');
    expect(uri).toContain('domainlistalways=email.example.com,pay.examplecloud.com');
    expect(uri).toContain('domainlistifneeded=intranet.example.com');
    expect(uri).toContain('domainlistnever=www.example.com');
  });
});

describe('buildConnectUri', () => {
  it('supports connecting by name only', () => {
    expect(buildConnectUri({ name: 'Example' })).toBe('anyconnect://connect/?name=Example');
  });

  it('keeps a Group URL unescaped in host', () => {
    expect(buildConnectUri({ name: 'Example', host: 'hr.example.com/group-url' })).toBe(
      'anyconnect://connect/?name=Example&host=hr.example.com/group-url'
    );
  });

  it('encodes prefilled credentials and group alias', () => {
    const uri = buildConnectUri({
      name: 'Example',
      host: 'hr.example.com',
      username: 'user1',
      password: 'password1',
      secondaryUsername: 'user2',
      secondaryPassword: 'password2',
      group: '10. Single Authentication',
    });

    expect(uri).toContain('prefill_username=user1');
    expect(uri).toContain('prefill_password=password1');
    expect(uri).toContain('prefill_secondary_username=user2');
    expect(uri).toContain('prefill_secondary_password=password2');
    expect(uri).toContain('prefill_group_list=10.%20Single%20Authentication');
  });

  it('fully encodes the onsuccess/onerror URLs, as Cisco documents', () => {
    const uri = buildConnectUri({
      host: 'vpn.company.com',
      onSuccess: 'http://www.cisco.com',
      onError: 'http://www.cisco.com/failure.html',
    });

    expect(uri).toContain('onsuccess=http%3A%2F%2Fwww.cisco.com');
    expect(uri).toContain('onerror=http%3A%2F%2Fwww.cisco.com%2Ffailure.html');
  });
});

describe('buildDisconnectUri', () => {
  it('has no query string when no callback is requested', () => {
    expect(buildDisconnectUri()).toBe('anyconnect://disconnect');
  });

  it('includes the Android-only onsuccess action when given one', () => {
    expect(buildDisconnectUri('myapp://anyconnect/callback?result=success')).toBe(
      'anyconnect://disconnect/?onsuccess=myapp%3A%2F%2Fanyconnect%2Fcallback%3Fresult%3Dsuccess'
    );
  });
});

describe('import helpers', () => {
  it('builds a profile import URI', () => {
    expect(buildImportProfileUri('file:///sdcard/profile.xml')).toBe(
      'anyconnect://import/?type=profile&uri=file%3A%2F%2F%2Fsdcard%2Fprofile.xml'
    );
  });

  it('builds a pkcs12 certificate import URI', () => {
    expect(buildImportCertificateUri({ uri: 'http://example.com/CertName.p12' })).toBe(
      'anyconnect://import/?type=pkcs12&uri=http%3A%2F%2Fexample.com%2FCertName.p12'
    );
  });

  it('builds a localization import URI', () => {
    expect(buildLocalizeUri({ lang: 'fr', host: 'asa.example.com' })).toBe(
      'anyconnect://import/?type=localization&lang=fr&host=asa.example.com'
    );
  });

  it('builds the close command', () => {
    expect(buildCloseUri()).toBe('anyconnect://close');
  });
});

describe('callback URLs', () => {
  it('round-trips through parseCallbackUrl', () => {
    const url = buildCallbackUrl('myapp', {
      action: 'connect',
      result: 'error',
      token: 'connect-abc-1',
      error: 'certificate rejected',
    });

    expect(url).toBe(
      'myapp://anyconnect/callback?action=connect&result=error&token=connect-abc-1&error=certificate%20rejected'
    );

    expect(parseCallbackUrl(url)).toEqual({
      action: 'connect',
      result: 'error',
      url,
      token: 'connect-abc-1',
      error: 'certificate rejected',
    });
  });

  it('normalises a scheme that was passed with a suffix', () => {
    expect(buildCallbackUrl('myapp://', { action: 'connect', result: 'success' })).toBe(
      'myapp://anyconnect/callback?action=connect&result=success'
    );
  });

  it('ignores URLs that are not ours', () => {
    expect(parseCallbackUrl('https://example.com/anyconnect/callback?result=success')).toBeNull();
    expect(parseCallbackUrl('myapp://anyconnect/callback')).toBeNull();
    expect(parseCallbackUrl('myapp://something/else?result=success')).toBeNull();
    expect(parseCallbackUrl('')).toBeNull();
  });

  it('reports an unknown action rather than dropping the event', () => {
    const event = parseCallbackUrl('myapp://anyconnect/callback?action=reconnect&result=success');
    expect(event?.action).toBe('unknown');
    expect(event?.result).toBe('success');
  });
});
