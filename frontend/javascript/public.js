(function () {
    const LANGUAGES = {
        en: { label: "English", flag: "GB" },
        hi: { label: "Hindi", flag: "IN" }

    };

    const TRANSLATIONS = {
        en: {
            navAbout: "About Us",
            navFeatures: "Features",
            navPricing: "Pricing",
            navContact: "Contact",
            footerPrivacy: "Privacy Policy",
            footerTerms: "Terms of Service",
            footerHelp: "Help Center",
            footerTagline: "TaskFlow helps teams move work forward with clarity, accountability, and momentum.",
            footerSupport: "Support",
            footerGetStarted: "Get started",
            footerCopyright: "© 2026 TaskFlow. All rights reserved."
        },
        
        hi: {
            navAbout: "हमारे बारे में",
            navFeatures: "फीचर्स",
            navPricing: "प्राइसिंग",
            navContact: "संपर्क",
            footerPrivacy: "गोपनीयता नीति",
            footerTerms: "सेवा की शर्तें",
            footerHelp: "हेल्प सेंटर",
            footerTagline: "TaskFlow टीमों को स्पष्टता, जवाबदेही और गति के साथ काम आगे बढ़ाने में मदद करता है.",
            footerSupport: "सहायता",
            footerGetStarted: "शुरू करें",
            footerCopyright: "© 2026 TaskFlow. सर्वाधिकार सुरक्षित."
        }
    };

    const NAV_ITEMS = [
        { href: "/about-us", key: "navAbout" },
        { href: "/features", key: "navFeatures" },
        { href: "/pricing", key: "navPricing" },
        { href: "/contact", key: "navContact" }
    ];

    const FOOTER_ITEMS = [
        { href: "/privacy-policy", key: "footerPrivacy" },
        { href: "/terms-of-service", key: "footerTerms" },
        { href: "/help-center", key: "footerHelp" }
    ];

    function getLanguage() {
        const saved = localStorage.getItem("taskflow-language");
        return LANGUAGES[saved] ? saved : "en";
    }

    function t(key) {
        const lang = getLanguage();
        return TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key] || key;
    }

    function flagEmoji(countryCode) {
        return countryCode
            .toUpperCase()
            .split("")
            .map((char) => String.fromCodePoint(127397 + char.charCodeAt()))
            .join("");
    }

    function renderHeader() {
        const mount = document.querySelector("[data-public-header]");
        if (!mount) return;

        mount.innerHTML = `
            <header class="auth-navbar auth-public-navbar">
                <a class="auth-logo" href="/">
                    <span class="auth-logo-mark">T</span>
                    <span>Task</span>
                </a>

                <nav class="auth-nav-links auth-public-nav" aria-label="Primary navigation">
                    ${NAV_ITEMS.map((item) => `
                        <a class="site-nav-link" href="${item.href}" data-i18n="${item.key}">${t(item.key)}</a>
                    `).join("")}
                </nav>

                <div class="site-actions">
                    <div class="language-dropdown" data-language-dropdown>
                        <button class="auth-language language-button" type="button" aria-haspopup="true" aria-expanded="false">
                            <i class="fa-solid fa-globe"></i>
                            <span data-language-label>${LANGUAGES[getLanguage()].label}</span>
                            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
                        </button>
                        <div class="language-menu" role="menu">
                            ${Object.entries(LANGUAGES).map(([code, value]) => `
                                <button class="language-option${code === getLanguage() ? " is-selected" : ""}" type="button" data-language-option="${code}">
                                    <span>${value.label}</span>
                                </button>
                            `).join("")}
                        </div>
                    </div>
                    <button class="mobile-nav-toggle" type="button" aria-label="Open navigation menu" data-mobile-toggle>
                        <i class="fa-solid fa-bars"></i>
                    </button>
                </div>
            </header>
        `;
    }

    function renderFooter() {
        const mount = document.querySelector("[data-public-footer]");
        if (!mount) return;

        mount.innerHTML = `
            <footer class="auth-footer">
                <span>&copy; 2026 TaskFlow. All rights reserved.</span>
                <a href="/privacy-policy">Privacy Policy</a>
                <a href="/terms-of-service">Terms of Service</a>
                <a href="/help-center">Help Center</a>
            </footer>
        `;
    }

    function applyTranslations() {
        document.documentElement.lang = getLanguage();

        document.querySelectorAll("[data-i18n]").forEach((element) => {
            const key = element.getAttribute("data-i18n");
            element.textContent = t(key);
        });

        const flag = document.querySelector("[data-language-flag]");
        const label = document.querySelector("[data-language-label]");

        if (flag && label) {
            const current = LANGUAGES[getLanguage()];
            flag.textContent = flagEmoji(current.flag);
            label.textContent = current.label;
        }

        document.querySelectorAll("[data-language-option]").forEach((button) => {
            button.classList.toggle("is-selected", button.dataset.languageOption === getLanguage());
        });
    }

    function setupHeaderInteractions() {
        const wrap = document.querySelector(".site-header-wrap") || document.querySelector(".auth-public-navbar");
        const toggle = document.querySelector("[data-mobile-toggle]");
        const dropdown = document.querySelector("[data-language-dropdown]");
        if (!dropdown) return;

        if (wrap && toggle) {
            toggle.addEventListener("click", () => {
                wrap.classList.toggle("menu-open");
            });
        }

        const button = dropdown.querySelector(".language-button");
        if (!button) return;

        button.addEventListener("click", () => {
            const open = dropdown.classList.toggle("open");
            button.setAttribute("aria-expanded", open ? "true" : "false");
        });

        dropdown.querySelectorAll("[data-language-option]").forEach((option) => {
            option.addEventListener("click", () => {
                localStorage.setItem("taskflow-language", option.dataset.languageOption);
                applyTranslations();
                dropdown.classList.remove("open");
                button.setAttribute("aria-expanded", "false");
            });
        });

        document.addEventListener("click", (event) => {
            if (!dropdown.contains(event.target)) {
                dropdown.classList.remove("open");
                button.setAttribute("aria-expanded", "false");
            }
        });
    }

    function setActiveNav() {
        const path = window.location.pathname.replace(/\/$/, "") || "/";
        document.querySelectorAll(".site-nav-link, .auth-nav-links a").forEach((link) => {
            const href = link.getAttribute("href");
            const isActive = href === path;
            link.classList.toggle("active", isActive);
            if (isActive) {
                link.setAttribute("aria-current", "page");
            }
        });
    }

    function installPageTransitions() {
        document.body.classList.add("page-ready");

        document.addEventListener("click", (event) => {
            const link = event.target.closest("a[href]");
            if (!link) return;

            const href = link.getAttribute("href");
            if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
            if (link.target === "_blank" || link.hasAttribute("download")) return;

            const target = new URL(link.href, window.location.origin);
            if (target.origin !== window.location.origin || target.pathname === window.location.pathname) return;

            event.preventDefault();
            document.body.classList.add("page-leaving");

            window.setTimeout(() => {
                window.location.href = target.href;
            }, 180);
        });
    }

    function createToastContainer() {
        if (document.querySelector(".toast-container")) return;

        const container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    function showToast(message, type) {
        createToastContainer();
        const container = document.querySelector(".toast-container");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fa-solid ${type === "success" ? "fa-circle-check" : "fa-circle-exclamation"}"></i>
            <div>${message}</div>
        `;

        container.appendChild(toast);

        window.setTimeout(() => {
            toast.remove();
        }, 4200);
    }

    function setupContactForm() {
        const form = document.querySelector("[data-contact-form]");
        if (!form) return;

        form.addEventListener("submit", (event) => {
            event.preventDefault();

            const fields = {
                name: form.querySelector("[name='name']"),
                email: form.querySelector("[name='email']"),
                subject: form.querySelector("[name='subject']"),
                message: form.querySelector("[name='message']")
            };

            let hasError = false;

            Object.entries(fields).forEach(([key, input]) => {
                const error = form.querySelector(`[data-error-for='${key}']`);
                if (!input.value.trim()) {
                    error.textContent = "This field is required.";
                    hasError = true;
                    return;
                }

                if (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) {
                    error.textContent = "Enter a valid email address.";
                    hasError = true;
                    return;
                }

                error.textContent = "";
            });

            if (hasError) {
                showToast("Please review the highlighted fields and try again.", "error");
                return;
            }

            const submit = form.querySelector("[type='submit']");
            submit.classList.add("is-loading");
            submit.disabled = true;

            window.setTimeout(() => {
                submit.classList.remove("is-loading");
                submit.disabled = false;
                form.reset();
                showToast("Your message has been sent. Our team will get back to you within one business day.", "success");
            }, 1200);
        });
    }

    function setupFaqAccordions() {
        document.querySelectorAll(".faq-item").forEach((item) => {
            const trigger = item.querySelector(".faq-trigger");
            if (!trigger) return;

            trigger.addEventListener("click", () => {
                const isOpen = item.classList.contains("open");
                item.parentElement.querySelectorAll(".faq-item").forEach((sibling) => sibling.classList.remove("open"));
                if (!isOpen) {
                    item.classList.add("open");
                }
            });
        });
    }

    function setupHelpSearch() {
        const input = document.querySelector("[data-help-search]");
        if (!input) return;

        input.addEventListener("input", () => {
            const query = input.value.trim().toLowerCase();
            document.querySelectorAll("[data-help-item]").forEach((item) => {
                const text = item.textContent.toLowerCase();
                item.classList.toggle("is-hidden", Boolean(query) && !text.includes(query));
            });
        });
    }

    function setupPricingToggle() {
        const toggle = document.querySelector("[data-pricing-toggle]");
        if (!toggle) return;

        const buttons = toggle.querySelectorAll("[data-billing]");
        const prices = document.querySelectorAll("[data-price-monthly]");

        buttons.forEach((button) => {
            button.addEventListener("click", () => {
                const mode = button.dataset.billing;
                buttons.forEach((item) => item.classList.toggle("active", item === button));

                prices.forEach((price) => {
                    const value = mode === "yearly" ? price.dataset.priceYearly : price.dataset.priceMonthly;
                    const period = mode === "yearly" ? "/month billed annually" : "/month";
                    price.querySelector(".price-value").textContent = value;
                    price.querySelector(".price-period").textContent = period;
                });
            });
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        renderHeader();
        renderFooter();
        applyTranslations();
        setupHeaderInteractions();
        setActiveNav();
        installPageTransitions();
        setupFaqAccordions();
        setupHelpSearch();
        setupPricingToggle();
        setupContactForm();
        window.scrollTo(0, 0);
    });

    window.TaskFlowPublic = { showToast };
})();
