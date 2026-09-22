// CloudFront Function (viewer-request) para staging.siia.casa / siia.casa
// Astro genera /servicios/index.html; S3 con OAC no resuelve índices, así que se reescriben las URLs limpias.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Archivos con extensión se sirven tal cual.
  if (/\.[^/]+$/.test(uri)) {
    return request;
  }

  // /servicios → redirección 301 a /servicios/ (URL canónica con diagonal final)
  if (!uri.endsWith('/')) {
    var qs = request.querystring;
    var query = Object.keys(qs).map(function (k) {
      return qs[k].multiValue
        ? qs[k].multiValue.map(function (v) { return k + '=' + v.value; }).join('&')
        : k + '=' + qs[k].value;
    }).join('&');
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: uri + '/' + (query ? '?' + query : '') } },
    };
  }

  request.uri = uri + 'index.html';
  return request;
}
