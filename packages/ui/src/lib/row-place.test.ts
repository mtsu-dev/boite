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
  expect(one.map(rowPlaces(one)).map(place => place?.text)).toEqual([undefined, undefined]);
  // Two rows of one project share a title: the line tells them apart by where they are.
  const twins = [...one, { machine: machine('m1'), project: orbit, thread: { id: 'c', title: 'Fix CI' } }];
  expect(twins.map(rowPlaces(twins)).map(place => place?.text)).toEqual(['orbit', undefined, 'orbit']);
  const projects = [...one, { machine: machine('m1'), project: site, thread: { id: 'c', title: 'Fix CI' } }];
  expect(projects.map(rowPlaces(projects)).map(place => place?.text)).toEqual(['orbit', 'orbit', 'site']);
  const machines = [...one, { machine: machine('m2'), project: orbit, thread: { id: 'a', title: 'Fix CI' } }];
  expect(machines.map(rowPlaces(machines)).map(place => place?.text)).toEqual(['orbit on m1', 'orbit on m1', 'orbit on m2']);
  // This app's own machine goes unsaid: only the other one is named, on its rows.
  expect(machines.map(rowPlaces(machines, 'm1')).map(place => place?.text)).toEqual(['orbit', 'orbit', 'orbit on m2']);
});

test('the machine is named only while two are connected, and an unreachable one always says so', () => {
  const orbit = project('o', 'orbit');
  const site = project('s', 'site');
  const at = (id: string, connection: string) => ({ id, label: id, store: { connection } });
  // Two machines listed, one of them asleep: the one connected is not worth a name on every row ("This computer ·").
  const asleep = [
    { machine: at('m1', 'ready'), project: orbit, thread: { id: 'a', title: 'Fix CI' } },
    { machine: at('m1', 'ready'), project: site, thread: { id: 'b', title: 'Docs' } },
    { machine: at('m2', 'closed'), project: orbit, thread: { id: 'c', title: 'Render' } }
  ];
  expect(asleep.map(rowPlaces(asleep)).map(place => place?.text)).toEqual(['orbit', 'site', 'orbit on m2 · Offline']);
  expect(asleep.map(rowPlaces(asleep, 'm1')).map(place => place?.text)).toEqual(['orbit', 'site', 'orbit on m2 · Offline']);
  // Both connected: the other machine is named, this app's own goes unsaid.
  const awake = asleep.map(row => ({ ...row, machine: at(row.machine.id, 'ready') }));
  expect(awake.map(rowPlaces(awake, 'm1')).map(place => place?.text)).toEqual(['orbit', 'site', 'orbit on m2']);
});

test('the machine is a place apart from its state: "on m2", then Offline as its own mark', () => {
  const orbit = project('o', 'orbit');
  const rows = [
    { machine: { id: 'm1', label: 'm1', store: { connection: 'ready' } }, project: orbit, thread: { id: 'a', title: 'Fix CI' } },
    { machine: { id: 'm2', label: 'm2', store: { connection: 'closed' } }, project: orbit, thread: { id: 'b', title: 'Docs' } }
  ];
  const place = rowPlaces(rows, 'm1')(rows[1]!);
  expect(place?.project).toBe('orbit');
  expect(place?.host).toMatchObject({ label: 'm2', state: 'offline', away: true });
});
