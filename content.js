console.log("Twitch Hover Preview script loaded!");

// --- Configuration ---
const THUMBNAIL_LINK_SELECTOR = 'a[data-a-target="preview-card-image-link"]';
const HOVER_DELAY_MS = 350;
const PREVIEW_QUALITY = "360p";
const LEAVE_DELAY_MS = 100; // Short delay before stopping after leaving

// --- State ---
let activePreviewElement = null; // The element currently showing a preview
let hoverTimeoutId = null;       // Timeout ID for starting a preview
let leaveTimeoutId = null;       // Timeout ID for stopping a preview
let elementPendingStop = null;   // Which element is scheduled to be stopped by leaveTimeoutId

// --- Constants ---
const IFRAME_MARKER_ATTR = 'data-hover-preview-iframe';
const HIDDEN_IMG_MARKER_ATTR = 'data-hover-preview-hidden-img';

// --- Functions --- (getChannelNameFromElement, getTwitchEmbedUrl, startPreview, stopPreview remain the same as the previous working version)

function getChannelNameFromElement(element) {
    if (!element) return null;
    const href = element.getAttribute('href');
    if (!href || href.startsWith('#')) return null; // Ignore empty hrefs or fragment links

    try {
        // Use window.location.origin as base for potentially relative URLs
        const url = new URL(href, window.location.origin);
        // Split pathname into non-empty segments
        const pathParts = url.pathname.split('/').filter(part => part.length > 0);

        if (pathParts.length > 0) {
            // --- Updated Checks ---

            // 1. Check for top-level VODs or Clips pages (e.g., /videos, /clips)
            if (pathParts[0] === 'videos' || pathParts[0] === 'clip' || pathParts[0] === 'clips') {
                 // console.log(`Skipping top-level VOD/Clip link: ${href}`);
                return null;
            }

            // 2. Check for channel-specific clips (e.g., /channelname/clip/slug)
            //    or channel-specific videos (e.g., /channelname/videos/...)
            //    or other non-live channel paths (e.g., /channelname/about)
            if (pathParts.length > 1 &&
               (pathParts[1] === 'clip' || pathParts[1] === 'clips' || pathParts[1] === 'videos' ||
                pathParts[1] === 'about' || pathParts[1] === 'schedule' || pathParts[1] === 'following' ||
                pathParts[1] === 'followers')) {
                // console.log(`Skipping channel VOD/Clip/Info link: ${href}`);
                return null;
            }

            // 3. Check for known non-channel top-level paths
            if (['directory', 'settings', 'subscriptions', 'inventory', 'wallet', /* add others if found */].includes(pathParts[0])) {
                 // console.log(`Skipping known non-channel path: ${href}`);
                 return null;
            }

            // 4. If it passed all checks, assume the first part is the live channel name.
            //    Basic sanity check: avoid overly long strings or paths with dots? (Optional)
            if (pathParts[0].length < 30 && !pathParts[0].includes('.')) {
                 // console.log(`Assuming live channel: ${pathParts[0]}`);
                 return pathParts[0];
            }

            // --- End of Updated Checks ---
        }
    } catch (e) {
        // Log errors only if they seem significant, avoid logging for invalid hrefs often found
        if (!(e instanceof TypeError)) { // Ignore TypeError which often happens with invalid hrefs
             console.error("Error parsing URL:", href, e);
        }
    }

    // If none of the conditions resulted in returning a channel name
    // console.warn(`Could not determine channel type or name from href: ${href}`); // Reduce noise
    return null;
}

function getTwitchEmbedUrl(channelName) {
    const parentHostname = window.location.hostname;
    const url = new URL('https://player.twitch.tv/');
    url.searchParams.set('channel', channelName);
    url.searchParams.set('parent', parentHostname);
    url.searchParams.set('muted', 'true');
    url.searchParams.set('quality', PREVIEW_QUALITY);
    url.searchParams.set('autoplay', 'true');
    url.searchParams.set('controls', 'false');

    return url.toString();
}

function startPreview(element, channelName) {
    // console.log(`Starting preview for ${channelName}`); // Reduce noise
    const imgElement = element.querySelector('img');
    if (!imgElement) { return; }
    if (!imgElement.offsetParent && !imgElement.closest('div[data-a-target="side-nav-card-avatar"]')) { return; }
    const width = imgElement.offsetWidth;
    const height = imgElement.offsetHeight;
    if (!width || !height) { return; }

    imgElement.style.display = 'none';
    imgElement.setAttribute(HIDDEN_IMG_MARKER_ATTR, 'true');

    const iframe = document.createElement('iframe');
    iframe.setAttribute('src', getTwitchEmbedUrl(channelName));
    iframe.setAttribute(IFRAME_MARKER_ATTR, 'true');
    iframe.setAttribute('width', width);
    iframe.setAttribute('height', height);
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.style.pointerEvents = 'none';

    imgElement.parentNode.insertBefore(iframe, imgElement);
    // console.log(`Preview iframe added for ${channelName}`); // Reduce noise
}

function stopPreview(element) {
    if (!element) return;
    // console.log(`Stopping preview for: ${getChannelNameFromElement(element)}`); // Reduce noise

    const iframe = element.querySelector(`iframe[${IFRAME_MARKER_ATTR}="true"]`);
    if (iframe) { iframe.remove(); }

    const imgElement = element.querySelector(`img[${HIDDEN_IMG_MARKER_ATTR}="true"]`);
    if (imgElement) {
        imgElement.style.display = '';
        imgElement.removeAttribute(HIDDEN_IMG_MARKER_ATTR);
    } else {
         const anyImg = element.querySelector('img');
         if (anyImg && anyImg.style.display === 'none') { anyImg.style.display = ''; }
    }
}

// --- Revised Event Handlers ---

function handleMouseEnter(event) {
    const targetLink = event.target.closest(THUMBNAIL_LINK_SELECTOR);
    if (!targetLink) return; // Exit if not hovering over a relevant link

    // --- Logic for handling pending stop ---
    if (leaveTimeoutId) {
        // Is there a stop pending, and is it for the *same* element we are now entering?
        if (elementPendingStop === targetLink) {
            // Yes, cancel the scheduled stop because we re-entered the same element.
            // console.log(`Re-entered ${getChannelNameFromElement(targetLink)}, cancelling pending stop.`);
            clearTimeout(leaveTimeoutId);
            leaveTimeoutId = null;
            elementPendingStop = null;
        }
        // If a stop was pending for a *different* element, we let it continue or handle it when the new preview starts.
    }
    // ------------------------------------

    // If we are already showing a preview in this exact element, do nothing more.
    if (targetLink === activePreviewElement && targetLink.querySelector(`iframe[${IFRAME_MARKER_ATTR}="true"]`)) {
         return;
    }

    // Clear any pending timeout to *start* a preview on this element
    clearTimeout(hoverTimeoutId);

    // Schedule the potential start of the preview
    hoverTimeoutId = setTimeout(() => {
        try {
            // --- Stop previous preview IF DIFFERENT ---
            // Check if there's an active preview and it's not the current target
            if (activePreviewElement && activePreviewElement !== targetLink) {
                // console.log(`Immediately stopping previous preview for: ${getChannelNameFromElement(activePreviewElement)} due to new hover start.`);
                // Ensure any pending *leave* timeout for the old element is also cleared.
                if (elementPendingStop === activePreviewElement) {
                    clearTimeout(leaveTimeoutId);
                    leaveTimeoutId = null;
                    elementPendingStop = null;
                }
                stopPreview(activePreviewElement);
                // activePreviewElement = null; // Set below after potential start
            }
            // -----------------------------------------

            const channelName = getChannelNameFromElement(targetLink);
            if (channelName) {
                // Check if a preview isn't already running here (double check)
                if (!targetLink.querySelector(`iframe[${IFRAME_MARKER_ATTR}="true"]`)) {
                    startPreview(targetLink, channelName);
                    activePreviewElement = targetLink; // Set this as the new active element
                    // If we just started a preview, ensure no stop is pending for it
                    if (elementPendingStop === targetLink) {
                         clearTimeout(leaveTimeoutId);
                         leaveTimeoutId = null;
                         elementPendingStop = null;
                    }
                }
            } else {
                 // If no channel name (e.g., VOD), ensure we clean up if needed
                 if (activePreviewElement === targetLink) {
                     stopPreview(targetLink);
                     activePreviewElement = null;
                 }
            }
        } catch (error) {
            console.error("Error during hover preview start:", error);
            if (targetLink) stopPreview(targetLink); // Attempt cleanup
            activePreviewElement = null;
        }
    }, HOVER_DELAY_MS);
}

function handleMouseLeave(event) {
    const targetLink = event.target.closest(THUMBNAIL_LINK_SELECTOR);
    const relatedTarget = event.relatedTarget;

    // Clear any pending timeout to *start* a preview (if mouse leaves before delay)
    clearTimeout(hoverTimeoutId);
    hoverTimeoutId = null;

    // --- Logic for scheduling stop ---
    if (targetLink && targetLink === activePreviewElement) {
        // Check if the mouse truly left the bounds of this element
        const trulyLeft = !relatedTarget || !targetLink.contains(relatedTarget);

        if (trulyLeft) {
            // If a stop isn't already pending for this element, schedule one.
            if (!leaveTimeoutId || elementPendingStop !== targetLink) {
                // Clear any previous pending stop for a *different* element (shouldn't happen often)
                clearTimeout(leaveTimeoutId);

                // console.log(`Mouse left active element (${getChannelNameFromElement(targetLink)}), scheduling stopPreview.`);
                elementPendingStop = targetLink; // Mark which element is pending stop
                leaveTimeoutId = setTimeout(() => {
                    // When the timeout fires, check if this element is *still* the one pending stop
                    if (elementPendingStop === targetLink) {
                        // console.log(`Executing delayed stopPreview for: ${getChannelNameFromElement(targetLink)}`);
                        try {
                            stopPreview(targetLink);
                        } catch (error) {
                            console.error("Error during delayed stopPreview:", error);
                        } finally {
                            // Only clear activePreviewElement if it matches the one we just stopped
                            if(activePreviewElement === targetLink) {
                                activePreviewElement = null;
                            }
                            leaveTimeoutId = null; // Clear timeout ID
                            elementPendingStop = null; // Clear pending element
                        }
                    }
                    // If elementPendingStop was changed/cleared before this timeout, do nothing.
                }, LEAVE_DELAY_MS);
            }
        }
        // else: Mouse moved within the active element, do nothing.
    }
    // ---------------------------------
}

// --- Event Listeners ---
document.body.addEventListener('mouseover', handleMouseEnter);
document.body.addEventListener('mouseout', handleMouseLeave);

// --- Initial Cleanup ---
window.addEventListener('load', () => {
    document.querySelectorAll(`iframe[${IFRAME_MARKER_ATTR}="true"]`).forEach(iframe => iframe.remove());
    document.querySelectorAll(`img[${HIDDEN_IMG_MARKER_ATTR}="true"]`).forEach(img => {
        img.style.display = '';
        img.removeAttribute(HIDDEN_IMG_MARKER_ATTR);
    });
    activePreviewElement = null;
    hoverTimeoutId = null;
    leaveTimeoutId = null;
    elementPendingStop = null;
    console.log("Twitch Hover Preview Initialized."); // Changed log message
});