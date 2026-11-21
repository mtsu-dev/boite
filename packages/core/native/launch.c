/*
 * The Linux launcher that ties an agent's process group to the core before the
 * agent runs (src/platform/linux-launcher.ts).
 *
 * `launch <statusFd> <guardFd> <tag> <path> <argv0> [args...]`: Bun starts it
 * as the leader of a new session, so its pid is the agent's pid and group.
 * It opens a pidfd on itself, hands it with the tag to the guard over the
 * guard's socket (SCM_RIGHTS), closes both descriptors and execs the agent.
 * The pidfd names this process and, through PIDFD_SIGNAL_PROCESS_GROUP, its
 * group, whatever pid numbers the kernel hands out later. Any failure writes
 * the errno to statusFd, which is close-on-exec, and exits 127; a successful
 * exec closes it, which the core reads as the end of the launch.
 *
 * `guard`: one per core, its socket on stdin. A message with a pidfd holds
 * that group under its tag; a message with only a tag drops the group. End of
 * input means the core is gone: SIGTERM to each group held, probes every tenth
 * of a second for two seconds as posix-kill.ts does, then SIGKILL.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
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
#define MAX_GROUPS 65536

extern char **environ;

static int group_signal(int fd, int sig) { return syscall(SYS_pidfd_send_signal, fd, sig, NULL, PIDFD_SIGNAL_PROCESS_GROUP) == 0; }

static void fail(int status, int error) {
  while (write(status, &error, sizeof error) < 0 && errno == EINTR) {}
  _exit(127);
}

static int guard(void) {
  static int fds[MAX_GROUPS];
  static unsigned tags[MAX_GROUPS];
  int n = 0;
  signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN); signal(SIGHUP, SIG_IGN); signal(SIGQUIT, SIG_IGN);
  for (;;) {
    unsigned tag;
    struct iovec iov = { &tag, sizeof tag };
    char control[CMSG_SPACE(sizeof(int))];
    struct msghdr message = { 0 };
    message.msg_iov = &iov; message.msg_iovlen = 1; message.msg_control = control; message.msg_controllen = sizeof control;
    ssize_t r = recvmsg(0, &message, MSG_CMSG_CLOEXEC);
    if (r < 0 && errno == EINTR) continue;
    if (r <= 0) break;
    struct cmsghdr *c = CMSG_FIRSTHDR(&message);
    int fd = -1;
    if (c && c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS) memcpy(&fd, CMSG_DATA(c), sizeof fd);
    if (fd >= 0) {
      if (n < MAX_GROUPS) { fds[n] = fd; tags[n++] = tag; } else close(fd);
      continue;
    }
    for (int i = 0; i < n; i++) if (tags[i] == tag) { close(fds[i]); fds[i] = fds[--n]; tags[i] = tags[n]; break; }
  }
  for (int i = 0; i < n; i++) group_signal(fds[i], SIGTERM);
  for (int t = 0; t < 20; t++) {
    int any = 0;
    for (int i = 0; i < n; i++) any |= group_signal(fds[i], 0);
    if (!any) return 0;
    struct timespec tenth = { 0, 100000000 };
    nanosleep(&tenth, NULL);
  }
  for (int i = 0; i < n; i++) group_signal(fds[i], SIGKILL);
  return 0;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "guard") == 0) return guard();
  if (argc < 7 || strcmp(argv[1], "launch") != 0) return 2;
  int status = atoi(argv[2]), sock = atoi(argv[3]);
  unsigned tag = (unsigned)strtoul(argv[4], NULL, 10);
  if (fcntl(status, F_SETFD, FD_CLOEXEC) < 0) _exit(127);
  int self = (int)syscall(SYS_pidfd_open, getpid(), 0);
  if (self < 0) fail(status, errno);
  struct iovec iov = { &tag, sizeof tag };
  char control[CMSG_SPACE(sizeof(int))] = { 0 };
  struct msghdr message = { 0 };
  message.msg_iov = &iov; message.msg_iovlen = 1; message.msg_control = control; message.msg_controllen = sizeof control;
  struct cmsghdr *c = CMSG_FIRSTHDR(&message);
  c->cmsg_level = SOL_SOCKET; c->cmsg_type = SCM_RIGHTS; c->cmsg_len = CMSG_LEN(sizeof(int));
  memcpy(CMSG_DATA(c), &self, sizeof self);
  ssize_t r;
  while ((r = sendmsg(sock, &message, MSG_NOSIGNAL)) < 0 && errno == EINTR) {}
  if (r < 0) fail(status, errno);
  close(self); close(sock);
  execve(argv[5], argv + 6, environ);
  fail(status, errno);
  return 127;
}
