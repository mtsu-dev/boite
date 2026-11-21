/*
 * The Linux launcher that ties an agent's process group to the core before the
 * agent runs (src/platform/linux-launcher.ts).
 *
 * `launch <statusFd> <guardFd> <tag> <path> <argv0> [args...]`: Bun starts it
 * as the leader of a new session, so its pid is the agent's pid and group.
 * It opens a pidfd on itself and hands it with the tag to the guard over the
 * guard's socket (SCM_RIGHTS), then waits for the guard's answer for that tag:
 * only a group the guard admitted goes on. It hands the same pidfd to the core
 * over statusFd, a close-on-exec socket, and waits for the core to say it has
 * it: a core that could not read it never sees an agent it cannot end. Then
 * it closes its descriptors and execs the agent. Any failure sends the step
 * that failed and its errno on statusFd and exits 127 before the agent runs;
 * a successful exec closes statusFd, which the core reads as the end of the
 * launch.
 *
 * `guard`: one per core, its socket on stdin. A message of a tag with a pidfd
 * holds that group under the tag and is answered with the tag and 0, or an
 * errno when the group could not be held (no descriptor left: the kernel
 * dropped it). A tag alone drops the group, unanswered. A tag and a signal
 * sends that signal to the group and answers with the result, for the core
 * to check at its start that the signals it relies on go through. End of
 * input means the core is gone: SIGTERM to each group held, probes every
 * tenth of a second for two seconds as posix-kill.ts does, then SIGKILL; a
 * probe that fails for any reason but ESRCH counts the group as still there.
 * The pidfd names the group, through PIDFD_SIGNAL_PROCESS_GROUP, whatever pid
 * numbers the kernel hands out later.
 *
 * `probe`: ignores SIGTERM, announces readiness on stdin and waits for a
 * signal or for the core to close that socket.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#ifndef SYS_pidfd_open
#define SYS_pidfd_open 434
#endif
#ifndef SYS_pidfd_send_signal
#define SYS_pidfd_send_signal 424
#endif
#ifndef PIDFD_SIGNAL_PROCESS_GROUP
#define PIDFD_SIGNAL_PROCESS_GROUP 4
#endif

extern char **environ;

/* 0 when delivered, else the errno. */
static int group_signal(int fd, int sig) { return syscall(SYS_pidfd_send_signal, fd, sig, NULL, PIDFD_SIGNAL_PROCESS_GROUP) == 0 ? 0 : errno; }

/* What a launch reports on statusFd: the step that failed and its errno, or {ADMITTED, 0} with the pidfd. */
enum step { ADMITTED = 0, SETUP = 1, GUARD = 2, EXEC = 3 };
struct report { int step; int error; };

static void fail(int status, int step, int error) {
  struct report r = { step, error };
  while (send(status, &r, sizeof r, MSG_NOSIGNAL) < 0 && errno == EINTR) {}
  _exit(127);
}

struct answer { unsigned tag; int error; };

static void answer(unsigned tag, int error) {
  struct answer a = { tag, error };
  while (send(0, &a, sizeof a, MSG_NOSIGNAL) < 0 && errno == EINTR) {}
}

/* A message carrying one descriptor. */
static ssize_t send_fd(int sock, const void *data, size_t length, int fd) {
  struct iovec iov = { (void *)data, length };
  char control[CMSG_SPACE(sizeof(int))];
  memset(control, 0, sizeof control);
  struct msghdr message = { 0 };
  message.msg_iov = &iov; message.msg_iovlen = 1; message.msg_control = control; message.msg_controllen = sizeof control;
  struct cmsghdr *c = CMSG_FIRSTHDR(&message);
  c->cmsg_level = SOL_SOCKET; c->cmsg_type = SCM_RIGHTS; c->cmsg_len = CMSG_LEN(sizeof(int));
  memcpy(CMSG_DATA(c), &fd, sizeof fd);
  ssize_t r;
  while ((r = sendmsg(sock, &message, MSG_NOSIGNAL)) < 0 && errno == EINTR) {}
  return r;
}

static int guard(void) {
  int *fds = NULL;
  unsigned *tags = NULL;
  size_t n = 0, size = 0;
  struct rlimit limit;
  /* As many groups as the hard limit allows: no cap of its own. */
  if (getrlimit(RLIMIT_NOFILE, &limit) == 0 && limit.rlim_cur < limit.rlim_max) { limit.rlim_cur = limit.rlim_max; setrlimit(RLIMIT_NOFILE, &limit); }
  signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN); signal(SIGHUP, SIG_IGN); signal(SIGQUIT, SIG_IGN);
  for (;;) {
    unsigned request[2];
    struct iovec iov = { request, sizeof request };
    char control[CMSG_SPACE(sizeof(int))];
    struct msghdr message = { 0 };
    message.msg_iov = &iov; message.msg_iovlen = 1; message.msg_control = control; message.msg_controllen = sizeof control;
    ssize_t r = recvmsg(0, &message, MSG_CMSG_CLOEXEC);
    if (r < 0 && errno == EINTR) continue;
    if (r <= 0) break;
    if (r != sizeof request[0] && r != sizeof request) continue;
    unsigned tag = request[0];
    struct cmsghdr *c = CMSG_FIRSTHDR(&message);
    int fd = -1;
    if (c && c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS && c->cmsg_len == CMSG_LEN(sizeof(int))) memcpy(&fd, CMSG_DATA(c), sizeof fd);
    /* The kernel drops a descriptor this process has no room for, and says so. */
    if (message.msg_flags & MSG_CTRUNC) { if (fd >= 0) close(fd); answer(tag, EMFILE); continue; }
    if (fd >= 0) {
      if (n == size) {
        size_t grown = size ? size * 2 : 64;
        int *f = realloc(fds, grown * sizeof *fds);
        if (f) fds = f;
        unsigned *t = f ? realloc(tags, grown * sizeof *tags) : NULL;
        if (t) tags = t;
        if (!f || !t) { close(fd); answer(tag, ENOMEM); continue; }
        size = grown;
      }
      fds[n] = fd; tags[n++] = tag;
      answer(tag, 0);
      continue;
    }
    if (r == sizeof request) {
      int error = ESRCH;
      for (size_t i = 0; i < n; i++) if (tags[i] == tag) { error = group_signal(fds[i], (int)request[1]); break; }
      answer(tag, error);
      continue;
    }
    for (size_t i = 0; i < n; i++) if (tags[i] == tag) { close(fds[i]); n--; fds[i] = fds[n]; tags[i] = tags[n]; break; }
  }
  for (size_t i = 0; i < n; i++) group_signal(fds[i], SIGTERM);
  for (int t = 0; t < 20; t++) {
    int any = 0;
    for (size_t i = 0; i < n; i++) any |= group_signal(fds[i], 0) != ESRCH;
    if (!any) return 0;
    struct timespec tenth = { 0, 100000000 };
    nanosleep(&tenth, NULL);
  }
  for (size_t i = 0; i < n; i++) group_signal(fds[i], SIGKILL);
  return 0;
}

static int probe(void) {
  if (signal(SIGTERM, SIG_IGN) == SIG_ERR) return 1;
  const int ready = 1;
  ssize_t sent;
  do { sent = send(0, &ready, sizeof ready, MSG_NOSIGNAL); } while (sent < 0 && errno == EINTR);
  if (sent != sizeof ready) return 1;
  char unused;
  while (read(0, &unused, sizeof unused) < 0 && errno == EINTR) {}
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "guard") == 0) return guard();
  if (argc == 2 && strcmp(argv[1], "probe") == 0) return probe();
  if (argc < 7 || strcmp(argv[1], "launch") != 0) return 2;
  int status = atoi(argv[2]), sock = atoi(argv[3]);
  unsigned tag = (unsigned)strtoul(argv[4], NULL, 10);
  if (fcntl(status, F_SETFD, FD_CLOEXEC) < 0) fail(status, SETUP, errno);
  int self = (int)syscall(SYS_pidfd_open, getpid(), 0);
  if (self < 0) fail(status, SETUP, errno);
  if (send_fd(sock, &tag, sizeof tag, self) < 0) fail(status, GUARD, errno);
  /* Only this launch waits on the socket: the core starts one at a time. An answer for another tag is a stale one. */
  for (;;) {
    struct answer a;
    ssize_t r = recv(sock, &a, sizeof a, 0);
    if (r < 0 && errno == EINTR) continue;
    if (r < 0) fail(status, GUARD, errno);
    if (r == 0) fail(status, GUARD, EPIPE);
    if (r != sizeof a || a.tag != tag) continue;
    if (a.error != 0) fail(status, GUARD, a.error);
    break;
  }
  struct report admitted = { ADMITTED, 0 };
  if (send_fd(status, &admitted, sizeof admitted, self) < 0) fail(status, SETUP, errno);
  /* The core's word that it holds the pidfd; anything else, its end closed included, and the agent never runs. */
  for (;;) {
    int held = 0;
    ssize_t r = recv(status, &held, sizeof held, 0);
    if (r < 0 && errno == EINTR) continue;
    if (r != sizeof held || held != 1) _exit(127);
    break;
  }
  close(self); close(sock);
  execve(argv[5], argv + 6, environ);
  fail(status, EXEC, errno);
  return 127;
}
