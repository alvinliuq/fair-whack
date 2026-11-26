// PetO and PETstock read by our own parsers (Zyte's extraction took the wrong price, 27 Nov). Fixtures are trimmed
// copies of the real pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePeto, parsePetstockList, parsePetstockProduct } from '../pipeline/html-parsers.js';
import { adaptZyte } from '../pipeline/zyte-source.js';

const petoCard = (name, href, now, was) => `<li class="product">
  <article class="card"><span class="tag sale-item">&nbsp;</span><figure class="card-figure"><a href="${href}"><img class="card-image lazyload" src="https://x/loading.svg"
  data-src="https://cdn11.bigcommerce.com/img/${encodeURIComponent(name)}.jpg?c=2" alt="${name}"></a></figure><div class="card-body">
  <h4 class="card-title">\r\n <a title="${name}" href="${href}" >${name}</a>\r\n </h4>
  <div class="card-text" data-test-info-type="price"><div class="price-section price-section--withTax offer" ><span class="price-label" style="display: none;"></span>
  <span data-product-price-with-tax class="price price--withTax">${now}</span></div>
  <div class="price-section price-section--withTax non-sale-price--withTax" ${was ? '' : 'style="display: none;"'}><span class="price-label"></span>
  <span data-product-non-sale-price-with-tax class="price price--non-sale">\r\n ${was || ''}\r\n </span></div></div></div></article>    </li>`;

test('PetO: sale price and everyday price, next page', () => {
  const html = `<ul>${petoCard('Black Hawk Lamb &amp; Rice Dry Adult Dog Food', 'https://peto.com.au/black-hawk-lamb-dry-adult-dog-food/', '$139.99', '$179.99')}
    ${petoCard('Prime100 Kangaroo &amp; Pumpkin Roll 2kg', 'https://peto.com.au/prime-100-kangaroo-pumpkin-roll-2kg/', '$24.99', '')}</ul>
    <li class="pagination-item pagination-item--next">\r\n <a class="pagination-link" href="https://peto.com.au/dog/dog-food/?page=2" data-faceted-search-facet>Next</a></li>`;
  const { items, next } = parsePeto(html, 'https://peto.com.au/dog/dog-food/');
  assert.equal(next, 'https://peto.com.au/dog/dog-food/?page=2');
  assert.deepEqual(items.map((x) => [x.name, x.price, x.regularPrice]), [['Black Hawk Lamb & Rice Dry Adult Dog Food', 139.99, 179.99], ['Prime100 Kangaroo & Pumpkin Roll 2kg', 24.99, null]]);
  const a = adaptZyte({ ...items[0], _category: 'Pet > Dog' });
  assert.equal(a.productId, 'black-hawk-lamb-dry-adult-dog-food');
  assert.equal(a.price, 139.99); assert.equal(a.wasPrice, 179.99); assert.equal(a.isOnSpecial, true);
});

const psCard = (slug, brand, name, sizes, save, price, auto) => `<a href="/products/${slug}?queryID=abc"><a class="css-1ltgj29"><div class="css-6xtwjr"><div>BLACK FURDAY - UP TO 25% OFF</div></div>
  <img alt="" src="/_next/image?url=https%3A%2F%2Fcdn.shopify.com%2Fs%2Ffiles%2F${slug}.jpg%3Fv%3D1&amp;w=384&amp;q=75"><div><div>Black Furday</div></div>
  <div><p class="css-1ar2f4x">${brand}</p></div><p data-product-title="true" class="css-qq4ixr">${name}</p>
  <style data-emotion="css x">.css-x{color:red}</style>
  <div>${sizes.map((s) => `<div><div class="css-1jv11b5">${s}</div><div class="css-25s8de">$</div></div>`).join('')}</div>
  <div class="css-b7sgxg"><div>${save ? `<div class="css-vobu5e">Save $<!-- -->${save}</div>` : ''}<p class="css-1xc60e5">$<!-- -->${price}</p></div>
  <div><div class="css-sj3v6t">Autoship </div><p class="css-1xc60e5">$${auto}</p></div></div><p>Collect 143 points</p></a></a>`;

test('PETstock listing: price is the Buy Once price, was = price + Save; Autoship ignored', () => {
  const html = `<div>${psCard('black-hawk-original-lamb-rice-adult-dry-dog-food-variant-122713000003', 'Black Hawk', 'Black Hawk Original Lamb &amp; Rice Adult Dry Dog Food', ['20kg', '3kg', '10kg'], '7.55', '143.45', '135.90')}
    ${psCard('nexgard-spectra-large-variant-1', 'NEXGARD SPECTRA', 'NexGard Spectra Large Breed 15.1-30kg Flea, Tick &amp; Worming Dog Chews', ['6pk', '3pk'], '11.00', '93.00', '93.60')}
    ${psCard('plain-food-variant-2', 'Acme', 'Acme Plain Dog Food', ['2kg'], '', '20.00', '18.00')}</div>`;
  const { items } = parsePetstockList(html, 'https://www.petstock.com.au/collections/dog-food');
  assert.deepEqual(items.map((x) => [x.price, x.regularPrice, x.size, x.brand?.name]), [[143.45, 151, '20kg', 'Black Hawk'], [93, 104, '6pk', 'NEXGARD SPECTRA'], [20, null, '2kg', 'Acme']]);
  assert.match(items[0].mainImage.url, /^https:\/\/cdn\.shopify\.com\//);
  assert.equal(adaptZyte(items[0]).productId, 'black-hawk-original-lamb-rice-adult-dry-dog-food-variant-122713000003');
});

test('PETstock product page: JSON-LD price and size, Was line', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Black Hawk Original Lamb & Rice Adult Dry Dog Food","brand":{"@type":"Brand","name":"Black Hawk"},"image":["https://cdn.shopify.com/a.jpg"],"offers":{"@type":"Offer","price":"143.45","priceCurrency":"AUD","availability":"https://schema.org/InStock"},"sku":"122713000003","size":"20kg"}</script>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Dog","item":"x"},{"@type":"ListItem","position":2,"name":"Dog Food","item":"y"}]}</script></head>
    <body><label><p>Buy Once</p></label><p class="css-5g9ue3">Save $<!-- -->7.55</p><p class="css-vpb5qa">Was $<!-- -->151.00</p><p>$<!-- -->143.45</p>
    <p id="autoship-price-label">Autoship</p><p>Was $<!-- -->151.00</p><p>$135.90</p></body></html>`;
  const url = 'https://www.petstock.com.au/products/black-hawk-original-lamb-rice-adult-dry-dog-food-variant-122713000003';
  const [p] = parsePetstockProduct(html, url).items;
  assert.deepEqual([p.price, p.regularPrice, p.size, p.breadcrumbs.map((b) => b.name).join(' > ')], [143.45, 151, '20kg', 'Dog > Dog Food']);
  const a = adaptZyte(p);
  assert.equal(a.productId, 'black-hawk-original-lamb-rice-adult-dry-dog-food-variant-122713000003');
  assert.equal(a.size, '20kg');
});
