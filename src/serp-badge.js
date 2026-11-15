// One badge, used on every surface whose content came from SerpApi, so the
// attribution is consistent wherever live search results appear.
export function serpBadge(label = 'Live web results') {
  const badge = document.createElement('span');
  badge.className = 'serp-tag';
  const mark = new Image();
  mark.src = '/serpapi-logo.svg';
  mark.alt = '';
  mark.width = 14;
  mark.height = 14;
  const link = document.createElement('a');
  link.href = 'https://serpapi.com/';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'SerpApi';
  badge.append(mark, link, document.createTextNode(' · ' + label));
  return badge;
}
