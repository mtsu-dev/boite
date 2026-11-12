// Hello's interface (`provides.ui.script`): a button in the conversation's
// header opens a panel tab that lists the conversations that changed last, and
// keeps it current. Boite calls the default export once, after startup, with
// its plugin API; docs/plugins.md, "Interface", describes every part of it.

const WAVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V6a2 2 0 1 1 4 0v5"/><path d="M11 10V4a2 2 0 1 1 4 0v6"/><path d="M15 9V6a2 2 0 1 1 4 0v8a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L3 14.5a2 2 0 0 1 3.4-2L7 13.5"/></svg>';

export default function hello(boite) {
  const openRecent = () => boite.ui.openPanelTab('recent');

  boite.ui.addButton({ id: 'recent', slot: 'thread-header', label: 'Recent conversations', icon: WAVE, onClick: openRecent });
  boite.ui.addCommand({ id: 'recent', title: 'Hello: recent conversations', onRun: openRecent });

  boite.ui.addPanelTab({
    id: 'recent',
    title: 'Recent',
    mount(element) {
      const list = document.createElement('ol');
      list.className = 'hello-recent';
      element.append(list);
      let stopped = false;

      async function draw() {
        const threads = await boite.rpc.call('threads.list', {});
        if (stopped) return;
        const latest = [...threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
        list.replaceChildren(...latest.map((thread) => {
          const row = document.createElement('li');
          const title = document.createElement('span');
          title.className = 'hello-title';
          title.textContent = thread.title || '(untitled)';
          const when = document.createElement('time');
          when.dateTime = new Date(thread.updatedAt).toISOString();
          when.textContent = new Date(thread.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          row.append(title, when);
          return row;
        }));
      }

      void draw();
      // `threads.read` grants the thread events too: the list follows them.
      const off = boite.rpc.on('thread.updated', () => void draw());
      return () => { stopped = true; off(); };
    },
  });

  // Under every message: how many words it has, in a toast of the plugin's own.
  boite.ui.addMessageAction({
    id: 'words',
    label: 'Count words',
    onClick({ text }) {
      const words = text.split(/\s+/).filter(Boolean).length;
      const toast = document.createElement('div');
      toast.className = 'hello-toast';
      toast.textContent = `${words} words`;
      document.body.append(toast);
      setTimeout(() => toast.remove(), 2000);
    },
  });
}
