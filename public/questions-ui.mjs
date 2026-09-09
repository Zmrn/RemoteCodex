import { asyncQuestions, questionReply, itemText } from "./message-content.mjs";
const node = (tag, cls, text) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
export class QuestionsUI {
  constructor(submit, onChange = () => {}) {
    this.submit = submit;
    this.onChange = onChange;
    this.drafts = new Map();
    this.sending = new Set();
    this.done = new Set();
  }
  snapshot() { return { drafts: [...this.drafts], done: [...this.done] }; }
  restore(saved) {
    this.drafts = new Map(saved?.drafts ?? []);
    this.done = new Set(saved?.done ?? []);
  }
  hasDrafts() { return [...this.drafts].some(([key, answers]) => !this.done.has(key) && Object.values(answers).some(Boolean)); }
  index(turns) {
    this.answers = new Map();
    this.known = new Set(
      turns
        .flatMap((t) => t.items ?? [])
        .flatMap(asyncQuestions)
        .map((q) => q.id),
    );
    for (const item of turns
      .flatMap((t) => t.items ?? [])
      .filter(
        (i) =>
          i.type === "userMessage" ||
          (i.type === "steeringUserMessage" && i.status === "accepted"),
      ))
      for (const answer of questionReply(itemText(item)) ?? [])
        this.answers.set(answer.questionItemId, answer.answer);
  }
  card(context, kind, questions, requestId, completedAnswers) {
    const key =
      context.agent + ":" + context.id + ":" + (requestId ?? questions[0].id);
    const card = node("section", "question-card");
    card.dataset.questionId = questions[0].id;
    const answers =
      completedAnswers ??
      Object.fromEntries(
        questions
          .filter((q) => this.answers.has(q.id))
          .map((q) => [q.id, this.answers.get(q.id)]),
      );
    const completed =
      questions.every((q) => Object.hasOwn(answers, q.id)) ||
      this.done.has(key);
    if (completed && !this.done.has(key)) { this.done.add(key); this.onChange(); }
    card.questionKey = key;
    card.questionSignature = JSON.stringify({ questions, answers, completed, connected: context.connected, sending: this.sending.has(key) });
    let draft = this.drafts.get(key);
    if (!draft)
      this.drafts.set(
        key,
        (draft = Object.fromEntries(questions.map((q) => [q.id, ""]))),
      );
    for (const q of questions) {
      card.append(node("p", "question-title", q.title));
      if (completed) {
        card.append(node("p", "question-answer", answers[q.id] ?? draft[q.id]));
        continue;
      }
      const input = node("textarea", "question-input");
      input.rows = 2;
      input.placeholder = "输入回答，也可以选择上方选项";
      input.value = draft[q.id] ?? "";
      input.setAttribute("aria-label", q.title);
      if (q.options.length) {
        const options = node("div", "question-options");
        for (const option of q.options) {
          const label = typeof option === "string" ? option : option.label;
          const button = node("button", "question-option", label);
          button.type = "button";
          if (typeof option === "object")
            button.title = option.description ?? "";
          button.disabled = !context.connected || this.sending.has(key);
          button.onclick = () => {
            draft[q.id] = label;
            input.value = label;
            for (const b of options.children)
              b.classList.toggle("selected", b === button);
            this.onChange();
          };
          button.classList.toggle("selected", draft[q.id] === label);
          options.append(button);
        }
        card.append(options);
      }
      input.disabled = !context.connected || this.sending.has(key);
      input.oninput = () => {
        draft[q.id] = input.value;
        for (const button of (input.previousElementSibling?.classList.contains('question-options') ? input.previousElementSibling.children : []))
          button.classList.toggle('selected', button.textContent === input.value);
        this.onChange();
      };
      card.append(input);
    }
    if (completed) card.append(node("small", "question-state", "已回答"));
    else {
      const status = node("p", "question-state");
      const button = node(
        "button",
        "question-submit",
        this.sending.has(key) ? "正在提交…" : "提交回答",
      );
      button.type = "button";
      button.disabled = !context.connected || this.sending.has(key);
      button.onclick = async () => {
        if (questions.some((q) => !draft[q.id]?.trim())) {
          status.textContent = "请回答所有问题";
          return;
        }
        this.sending.add(key);
        button.disabled = true;
        status.textContent = "正在提交…";
        try {
          await this.submit(
            context,
            kind === "request"
              ? { kind, questionRequestId: requestId, answers: { ...draft } }
              : {
                  kind,
                  answers: questions.map((q) => ({
                    questionItemId: q.id,
                    answer: draft[q.id],
                  })),
                },
          );
          this.done.add(key);
          this.onChange();
          status.textContent = "已提交到官方会话";
        } catch (e) {
          status.textContent = e.message;
        } finally {
          this.sending.delete(key);
          if (!this.done.has(key)) button.disabled = !context.connected;
        }
      };
      card.append(button, status);
    }
    return card;
  }
  render(item, context) {
    const questions = asyncQuestions(item);
    if (questions.length) return this.card(context, "async", questions);
    if (item.type !== "userInputResponse") return null;
    const qs = (item.questions ?? []).map((q) => ({
      id: q.id,
      title: q.question,
      options: q.options ?? [],
    }));
    if (!qs.length) return null;
    const answers = item.completed
      ? Object.fromEntries(
          qs.map((q) => [q.id, (item.answers?.[q.id] ?? []).join("\n")]),
        )
      : undefined;
    return this.card(context, "request", qs, item.requestId, answers);
  }
}
