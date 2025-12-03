let currentStep = 1;

function goToStep(step) {
    document.querySelectorAll('.step').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.step) === step);
    });
}

document.querySelectorAll('.btn-next, .btn-finish').forEach((btn) => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('btn-finish')) {
            chrome.storage?.local.set({ onboardingCompleted: true }).catch?.(() => {});
            try {
                chrome.tabs.create({ url: chrome.runtime.getURL('popup/popup.html') });
            } catch (error) {
                console.warn('Failed to open popup after onboarding:', error);
            }
            window.close();
            return;
        }
        currentStep += 1;
        goToStep(currentStep);
    });
});

const demoInput = document.getElementById('snippet-demo');
if (demoInput) {
    demoInput.addEventListener('input', (e) => {
        if (e.target.value.includes('@sig')) {
            e.target.value = e.target.value.replace('@sig', 'Best regards,\nYour Name\nemail@example.com');
        }
    });
}
