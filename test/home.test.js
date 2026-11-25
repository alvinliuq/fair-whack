import test from 'node:test';
import assert from 'node:assert/strict';
import { similarity, profileVector, rankTop, groupOf } from '../shared/home.js';

const u = (age, gender, size, favs) => ({ age_range: age, gender, household_size: size, fav_categories: JSON.stringify(favs) });

test('similar households score 0.8 or more, different ones do not', () => {
  const a = profileVector(u('35-44', 'female', '4', ['Baby', 'Pantry']), { about: { members: [{ age: '35-44' }, { age: '5-12' }], pets: ['dog'] } });
  const b = profileVector(u('35-44', 'female', '4', ['Baby', 'Pantry']), { about: { members: [{ age: '35-44' }, { age: '0-4' }], pets: ['dog'] } });
  const c = profileVector(u('65+', 'male', '1', ['Liquor']), { about: { members: [{ age: '65+' }], pets: ['none'] } });
  assert.ok(similarity(a, b) >= 0.8);
  assert.ok(similarity(a, c) < 0.8);
});

test('too few shared answers are not comparable', () => {
  assert.equal(similarity(profileVector(u('35-44', null, null, [])), profileVector(u('35-44', null, null, []))), 0);
});

test('Top 20 needs at least 2 different people per product', () => {
  const adds = [{ user_id: 'a', product_id: 'x' }, { user_id: 'b', product_id: 'x' }, { user_id: 'a', product_id: 'y' }, { user_id: 'c', product_id: 'z' }, { user_id: 'd', product_id: 'z' }, { user_id: 'e', product_id: 'z' }];
  assert.deepEqual(rankTop(adds, null).map((r) => r.id), ['z', 'x']);
  assert.deepEqual(rankTop(adds, ['a', 'b']).map((r) => r.id), ['x']);
});

test('categories fall into the 8 groups', () => {
  assert.equal(groupOf('Bakery'), 'Fresh Food');
  assert.equal(groupOf('Toys & Games'), 'Baby & Kids');
  assert.equal(groupOf('Clothing & Shoes'), null);
});
