export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      });
    }

    const text = url.searchParams.get('text') || '';
    const itc = url.searchParams.get('itc') || 'hi-t-i0-und';
    const upstream = 'https://inputtools.google.com/request?text=' + encodeURIComponent(text) +
      '&itc=' + encodeURIComponent(itc) + '&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8';

    const resp = await fetch(upstream);
    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  },
};
