const el = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
export class ThreadMenu {
  constructor({ current, submit, refresh }) {
    Object.assign(this, { current, submit, refresh }); this.epoch = 0;
    this.menu = el('div', '', 'thread-context-menu'); this.menu.setAttribute('role', 'menu'); this.menu.hidden = true;
    this.rename = el('button', '重命名'); this.rename.type = 'button'; this.rename.setAttribute('role', 'menuitem'); this.menu.append(this.rename);
    this.dialog = el('dialog', '', 'thread-rename-dialog');
    this.form = el('form'); const heading = el('h2', '重命名会话'); heading.id = 'thread-rename-heading'; this.dialog.setAttribute('aria-labelledby', heading.id);
    this.device = el('p', '', 'field-help'); this.input = el('input'); this.input.setAttribute('aria-label', '会话名称'); this.input.maxLength = 200; this.input.required = true;
    this.message = el('p', '', 'field-help'); this.message.setAttribute('role', 'status');
    const actions = el('div', '', 'thread-rename-actions'); this.cancel = el('button', '取消'); this.cancel.type = 'button';
    this.save = el('button', '保存', 'primary'); this.save.type = 'submit'; actions.append(this.cancel, this.save);
    this.form.append(heading, this.device, this.input, this.message, actions); this.dialog.append(this.form); document.body.append(this.menu, this.dialog);
    this.rename.onclick = () => { const target = this.target; this.closeMenu(); if (!this.valid(target)) return; this.edit = target; this.input.value = target.title ?? ''; this.device.textContent = target.deviceName; this.message.textContent = ''; this.save.disabled = false; this.input.disabled = false; this.dialog.showModal(); this.input.focus(); this.input.select(); };
    this.cancel.onclick = () => this.dialog.close();
    this.dialog.addEventListener('close', () => { this.epoch++; });
    document.addEventListener('pointerdown', e => { if (!this.menu.contains(e.target)) this.closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeMenu(); });
    window.addEventListener('resize', () => this.closeMenu());
    document.addEventListener('scroll', () => this.closeMenu(), true);
    this.form.onsubmit = async e => {
      e.preventDefault(); if (this.save.disabled || !this.valid(this.edit)) return;
      const target = this.edit, epoch = this.epoch, title = this.input.value.trim(); if (!title) return;
      this.save.disabled = true; this.input.disabled = true; this.message.textContent = '正在提交…';
      try {
        const result = await this.submit(target, { title, expectedTitle: target.title ?? null });
        if (epoch !== this.epoch) return;
        if (result.status === 'accepted') { this.dialog.close(); this.refresh(target); }
        else { this.message.textContent = result.error ?? '提交结果未知，请刷新官方列表核对。'; this.save.disabled = result.status !== 'not-sent'; this.input.disabled = this.save.disabled; }
      } catch { if (epoch === this.epoch) this.message.textContent = '提交结果未知，请刷新官方列表核对，不要重复提交。'; }
    };
  }
  valid(target) { const c = this.current(); return target && c.agent === target.agent && c.generation === target.generation && c.connected && c.canRename; }
  closeMenu() { this.menu.hidden = true; }
  reset() { this.closeMenu(); if (this.dialog.open) this.dialog.close(); this.epoch++; }
  bind(button, thread) {
    const context = this.current(); let timer, start, suppressClick = false;
    const open = (x, y) => {
      const c = this.current(); if (c.agent !== context.agent || c.generation !== context.generation) return;
      this.target = { ...context, id: thread.id, title: thread.title, kind: thread.kind };
      this.rename.disabled = !this.valid(this.target) || thread.kind !== 'codex';
      this.rename.textContent = thread.kind !== 'codex' ? 'Chat 改名需在官方应用操作' : '重命名';
      this.menu.hidden = false; this.menu.style.left = Math.min(x, innerWidth - this.menu.offsetWidth - 8) + 'px'; this.menu.style.top = Math.min(y, innerHeight - this.menu.offsetHeight - 8) + 'px'; this.rename.focus();
    };
    button.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(timer); const r = button.getBoundingClientRect(); open(e.clientX || r.left, e.clientY || r.bottom); });
    button.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') return; start = { x: e.clientX, y: e.clientY }; timer = setTimeout(() => { suppressClick = true; open(start.x, start.y); }, 500); });
    button.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clearTimeout(timer); });
    for (const event of ['pointerup', 'pointercancel']) button.addEventListener(event, () => { clearTimeout(timer); start = null; });
    button.addEventListener('click', e => { if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; } }, true);
  }
}
