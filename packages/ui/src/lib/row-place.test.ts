import { expect, test } from 'vitest';
import type { Project } from '@boite/contracts';
import { rowPlaces } from './row-place';

const project = (id: string, name: string) => ({ id, name, path: `/p/${name}` }) as unknown as Project;
const machine = (id: string) => ({ id, label: id });

test('a flat list names the project when it spans several, the machine when it spans several too', () => {
  const orbit = project('o', 'orbit');
  const site = project('s', 'site');
  const one = [{ machine: machine('m1'), project: orbit, thread: { id: 'a', title: 'Fix CI' } }, { machine: machine('m1'), project: orbit, thread: { id: 'b', title: 'Docs' } }];
  // One project on one machine, no title twice: the tile says it all.
  expect(one.map(rowPlaces(one))).toEqual([undefined, undefined]);
  // Two rows of one project share a title: the line tells them apart by where they are.
  const twins = [...one, { machine: machine('m1'), project: orbit, thread: { id: 'c', title: 'Fix CI' } }];
  expect(twins.map(rowPlaces(twins))).toEqual(['orbit', undefined, 'orbit']);
  const projects = [...one, { machine: machine('m1'), project: site, thread: { id: 'c', title: 'Fix CI' } }];
  expect(projects.map(rowPlaces(projects))).toEqual(['orbit', 'orbit', 'site']);
  const machines = [...one, { machine: machine('m2'), project: orbit, thread: { id: 'a', title: 'Fix CI' } }];
  expect(machines.map(rowPlaces(machines))).toEqual(['orbit · m1', 'orbit · m1', 'orbit · m2']);
});
