(function () {
    const messages = document.getElementById("messages");
    const input = document.getElementById("chat-input");
    const sendBtn = document.getElementById("send-btn");
    const chatBtn = document.getElementById("chat-btn");
    const chatBox = document.getElementById("chat-box");
    const closeChat = document.getElementById("close-chat");

    if (!messages || !input || !sendBtn || !chatBtn || !chatBox || !closeChat) {
        return;
    }

    const defaultPrompts = [
        "Give me a dashboard summary",
        "What should I focus on today?",
        "Which project needs attention?"
    ];

    function getDisplayName() {
        const username = sessionStorage.getItem("username");
        const email = sessionStorage.getItem("email");
        return (username || email || "there").split("@")[0];
    }

    function scrollToBottom() {
        messages.scrollTop = messages.scrollHeight;
    }

    function createMessage(text, sender) {
        const row = document.createElement("div");
        row.className = `message ${sender === "user" ? "message-user" : "message-bot"}`;

        const bubble = document.createElement("div");
        bubble.className = sender === "user" ? "user-message" : "bot-message";
        bubble.textContent = text;

        row.appendChild(bubble);
        messages.appendChild(row);
        scrollToBottom();

        return row;
    }

    function createTypingMessage() {
        const row = document.createElement("div");
        row.className = "message message-bot";
        row.setAttribute("data-typing", "true");

        const bubble = document.createElement("div");
        bubble.className = "bot-message typing-bubble";
        bubble.setAttribute("aria-label", "TaskFlow Assistant is typing");

        for (let i = 0; i < 3; i += 1) {
            const dot = document.createElement("span");
            bubble.appendChild(dot);
        }

        row.appendChild(bubble);
        messages.appendChild(row);
        scrollToBottom();
        return row;
    }

    function removeTypingMessage(row) {
        if (row && row.parentNode) {
            row.remove();
        }
    }

    function setLoading(isLoading) {
        sendBtn.disabled = isLoading;
        input.disabled = isLoading;
        chatBox.classList.toggle("chat-loading", isLoading);
    }

    function renderQuickReplies(replies = defaultPrompts) {
        const existing = messages.querySelector(".quick-replies");
        if (existing) existing.remove();

        const cleanReplies = replies
            .filter(Boolean)
            .slice(0, 3);

        if (!cleanReplies.length) return;

        const wrap = document.createElement("div");
        wrap.className = "quick-replies";

        cleanReplies.forEach(reply => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "quick-reply";
            button.textContent = reply;
            button.addEventListener("click", () => {
                input.value = reply;
                sendMessage();
            });
            wrap.appendChild(button);
        });

        messages.appendChild(wrap);
        scrollToBottom();
    }

    function showWelcome() {
        if (messages.dataset.initialized === "true") return;
        messages.dataset.initialized = "true";
        createMessage(`👋 Hello ${getDisplayName()}!`, "bot");
        renderQuickReplies(defaultPrompts);
    }

    async function sendMessage() {
        const message = input.value.trim();
        if (!message) return;

        const token = sessionStorage.getItem("token");
        createMessage(message, "user");
        input.value = "";

        if (!token) {
            createMessage("🔒 Please log in again to use the TaskFlow Assistant.", "bot");
            return;
        }

        const typing = createTypingMessage();
        setLoading(true);

        try {
            const response = await fetch("/chat/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ message })
            });

            removeTypingMessage(typing);

            if (response.status === 401 || response.status === 403) {
                createMessage("🔒 Your session has expired. Please log in again.", "bot");
                return;
            }

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                createMessage(data.detail || data.message || "I could not process that request right now.", "bot");
                return;
            }

            createMessage(data.response || "I could not find an answer for that yet.", "bot");
            renderQuickReplies(Array.isArray(data.quick_replies) ? data.quick_replies : defaultPrompts);
        } catch (error) {
            removeTypingMessage(typing);
            console.error(error);
            createMessage("❌ Unable to connect to the TaskFlow Assistant.", "bot");
        } finally {
            setLoading(false);
            input.focus();
        }
    }

    sendBtn.addEventListener("click", sendMessage);

    input.addEventListener("keydown", event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    chatBtn.addEventListener("click", () => {
        chatBox.classList.add("open");
        chatBtn.classList.add("hidden");
        showWelcome();
        input.focus();
    });

    closeChat.addEventListener("click", () => {
        chatBox.classList.remove("open");
        chatBtn.classList.remove("hidden");
    });
})();
