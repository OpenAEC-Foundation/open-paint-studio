// THROWAWAY SPIKE (spikes/gpu): the CPU draws the first frame of an X11
// window while a background thread starts Vulkan (instance, device, then a
// surface on the same window and a swapchain); the window then switches to
// the GPU. Prints "NAME <CLOCK_MONOTONIC us>" for spikes/gpu/measure.py.
//
//   parallel_start [parallel|after|gpu-only] [discrete|integrated]
//
// parallel: Vulkan starts at once on a thread, the CPU frame goes first.
// after:    Vulkan starts on a thread after the CPU frame is shown.
// gpu-only: no CPU frame; Vulkan on the main thread, as a GPU-only app.
#define VK_USE_PLATFORM_XLIB_KHR
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <vulkan/vulkan.h>

enum { WIDTH = 1440, HEIGHT = 940 };

static long long now_us(void) {
	struct timespec t;
	clock_gettime(CLOCK_MONOTONIC, &t);
	return (long long)t.tv_sec * 1000000 + t.tv_nsec / 1000;
}
static pthread_mutex_t print_lock = PTHREAD_MUTEX_INITIALIZER;
static void stamp(const char *name) {
	long long t = now_us();
	pthread_mutex_lock(&print_lock);
	printf("%s %lld\n", name, t);
	fflush(stdout);
	pthread_mutex_unlock(&print_lock);
}
#define CHECK(call) do { VkResult r_ = (call); if (r_ != VK_SUCCESS) { fprintf(stderr, "%s failed: %d\n", #call, r_); exit(1); } } while (0)

static Window window;
static atomic_int window_ready, gpu_ready, want_integrated;
static VkInstance instance;
static VkPhysicalDevice physical;
static VkDevice device;
static uint32_t queue_family;
static VkQueue queue;

// Instance and device: nothing here needs the window.
static void start_device(void) {
	const char *extensions[] = {VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_XLIB_SURFACE_EXTENSION_NAME};
	VkApplicationInfo app = {.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO, .apiVersion = VK_API_VERSION_1_1};
	VkInstanceCreateInfo info = {.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO, .pApplicationInfo = &app,
		.enabledExtensionCount = 2, .ppEnabledExtensionNames = extensions};
	CHECK(vkCreateInstance(&info, NULL, &instance));
	stamp("instance");
	uint32_t count = 0;
	vkEnumeratePhysicalDevices(instance, &count, NULL);
	VkPhysicalDevice devices[16];
	if (count > 16) count = 16;
	vkEnumeratePhysicalDevices(instance, &count, devices);
	VkPhysicalDeviceType wanted = want_integrated ? VK_PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU : VK_PHYSICAL_DEVICE_TYPE_DISCRETE_GPU;
	physical = devices[0];
	for (uint32_t i = 0; i < count; i++) {
		VkPhysicalDeviceProperties p;
		vkGetPhysicalDeviceProperties(devices[i], &p);
		if (p.deviceType == wanted) { physical = devices[i]; break; }
	}
	VkPhysicalDeviceProperties chosen;
	vkGetPhysicalDeviceProperties(physical, &chosen);
	fprintf(stderr, "device: %s\n", chosen.deviceName);
	uint32_t families = 0;
	vkGetPhysicalDeviceQueueFamilyProperties(physical, &families, NULL);
	VkQueueFamilyProperties props[16];
	if (families > 16) families = 16;
	vkGetPhysicalDeviceQueueFamilyProperties(physical, &families, props);
	for (queue_family = 0; queue_family < families; queue_family++)
		if (props[queue_family].queueFlags & VK_QUEUE_GRAPHICS_BIT) break;
	float priority = 1.0f;
	VkDeviceQueueCreateInfo queue_info = {.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,
		.queueFamilyIndex = queue_family, .queueCount = 1, .pQueuePriorities = &priority};
	const char *device_extensions[] = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
	VkDeviceCreateInfo device_info = {.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO, .queueCreateInfoCount = 1,
		.pQueueCreateInfos = &queue_info, .enabledExtensionCount = 1, .ppEnabledExtensionNames = device_extensions};
	CHECK(vkCreateDevice(physical, &device_info, NULL, &device));
	vkGetDeviceQueue(device, queue_family, 0, &queue);
	stamp("device");
}

// Surface on the window the CPU already shows, a swapchain, and one frame
// of the same colours presented through it.
static void start_presenting(Display *display) {
	VkXlibSurfaceCreateInfoKHR surface_info = {.sType = VK_STRUCTURE_TYPE_XLIB_SURFACE_CREATE_INFO_KHR, .dpy = display, .window = window};
	VkSurfaceKHR surface;
	CHECK(vkCreateXlibSurfaceKHR(instance, &surface_info, NULL, &surface));
	VkBool32 supported = VK_FALSE;
	vkGetPhysicalDeviceSurfaceSupportKHR(physical, queue_family, surface, &supported);
	if (!supported) { fprintf(stderr, "surface not supported\n"); exit(1); }
	VkSurfaceCapabilitiesKHR caps;
	vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physical, surface, &caps);
	uint32_t format_count = 0;
	vkGetPhysicalDeviceSurfaceFormatsKHR(physical, surface, &format_count, NULL);
	VkSurfaceFormatKHR formats[64];
	if (format_count > 64) format_count = 64;
	vkGetPhysicalDeviceSurfaceFormatsKHR(physical, surface, &format_count, formats);
	stamp("surface");
	if (getenv("SPIKE_DEBUG"))
		fprintf(stderr, "caps: images %u-%u extent %ux%u usage 0x%x formats %u first %d\n", caps.minImageCount, caps.maxImageCount,
			caps.currentExtent.width, caps.currentExtent.height, caps.supportedUsageFlags, format_count, formats[0].format);
	// Some presentation paths (a GPU that is not driving the screen) refuse
	// transfer usage: then only the colour-attachment usage, as the DynLex
	// runtime asks, and the frame is a layout change without a clear.
	int clear = (caps.supportedUsageFlags & VK_IMAGE_USAGE_TRANSFER_DST_BIT) && !getenv("SPIKE_COLOR_ONLY");
	VkCompositeAlphaFlagBitsKHR alpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
	if (!(caps.supportedCompositeAlpha & alpha)) alpha = VK_COMPOSITE_ALPHA_INHERIT_BIT_KHR;
	uint32_t images_wanted = caps.minImageCount + 1;
	if (caps.maxImageCount && images_wanted > caps.maxImageCount) images_wanted = caps.maxImageCount;
	VkSwapchainCreateInfoKHR swap_info = {.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR, .surface = surface,
		.minImageCount = images_wanted, .imageFormat = formats[0].format, .imageColorSpace = formats[0].colorSpace,
		.imageExtent = caps.currentExtent.width == UINT32_MAX ? (VkExtent2D){WIDTH, HEIGHT} : caps.currentExtent,
		.imageArrayLayers = 1, .imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT | (clear ? VK_IMAGE_USAGE_TRANSFER_DST_BIT : 0),
		.preTransform = caps.currentTransform, .compositeAlpha = alpha,
		.presentMode = VK_PRESENT_MODE_FIFO_KHR, .clipped = VK_TRUE};
	VkSwapchainKHR swapchain;
	CHECK(vkCreateSwapchainKHR(device, &swap_info, NULL, &swapchain));
	uint32_t image_count = 0;
	vkGetSwapchainImagesKHR(device, swapchain, &image_count, NULL);
	VkImage images[8];
	if (image_count > 8) image_count = 8;
	vkGetSwapchainImagesKHR(device, swapchain, &image_count, images);
	stamp("swapchain");
	VkCommandPoolCreateInfo pool_info = {.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO, .queueFamilyIndex = queue_family};
	VkCommandPool pool;
	CHECK(vkCreateCommandPool(device, &pool_info, NULL, &pool));
	VkCommandBufferAllocateInfo alloc = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO, .commandPool = pool,
		.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY, .commandBufferCount = 1};
	VkCommandBuffer commands;
	CHECK(vkAllocateCommandBuffers(device, &alloc, &commands));
	VkSemaphoreCreateInfo semaphore_info = {.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
	VkSemaphore acquired, rendered;
	CHECK(vkCreateSemaphore(device, &semaphore_info, NULL, &acquired));
	CHECK(vkCreateSemaphore(device, &semaphore_info, NULL, &rendered));
	uint32_t index;
	CHECK(vkAcquireNextImageKHR(device, swapchain, UINT64_MAX, acquired, VK_NULL_HANDLE, &index));
	VkCommandBufferBeginInfo begin = {.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO, .flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT};
	vkBeginCommandBuffer(commands, &begin);
	VkImageSubresourceRange range = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
	VkImageMemoryBarrier to_transfer = {.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER, .dstAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT,
		.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED, .newLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL,
		.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED, .image = images[index], .subresourceRange = range};
	vkCmdPipelineBarrier(commands, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, 0, 0, NULL, 0, NULL, 1, &to_transfer);
	VkClearColorValue color = {.float32 = {0.98f, 0.98f, 0.976f, 1.0f}};
	if (clear)
		vkCmdClearColorImage(commands, images[index], VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, &color, 1, &range);
	VkImageMemoryBarrier to_present = to_transfer;
	to_present.srcAccessMask = VK_ACCESS_TRANSFER_WRITE_BIT;
	to_present.dstAccessMask = 0;
	to_present.oldLayout = VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL;
	to_present.newLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
	vkCmdPipelineBarrier(commands, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_BOTTOM_OF_PIPE_BIT, 0, 0, NULL, 0, NULL, 1, &to_present);
	vkEndCommandBuffer(commands);
	VkPipelineStageFlags wait_stage = VK_PIPELINE_STAGE_TRANSFER_BIT;
	VkSubmitInfo submit = {.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO, .waitSemaphoreCount = 1, .pWaitSemaphores = &acquired,
		.pWaitDstStageMask = &wait_stage, .commandBufferCount = 1, .pCommandBuffers = &commands,
		.signalSemaphoreCount = 1, .pSignalSemaphores = &rendered};
	CHECK(vkQueueSubmit(queue, 1, &submit, VK_NULL_HANDLE));
	VkPresentInfoKHR present = {.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR, .waitSemaphoreCount = 1, .pWaitSemaphores = &rendered,
		.swapchainCount = 1, .pSwapchains = &swapchain, .pImageIndices = &index};
	CHECK(vkQueuePresentKHR(queue, &present));
	vkQueueWaitIdle(queue);
	stamp("gpu-presented");
}

static void *gpu_thread(void *unused) {
	(void)unused;
	stamp("thread");
	start_device();
	while (!atomic_load(&window_ready)) {
		struct timespec pause = {0, 200000};
		nanosleep(&pause, NULL);
	}
	Display *display = XOpenDisplay(NULL);
	start_presenting(display);
	atomic_store(&gpu_ready, 1);
	return NULL;
}

static long long pss_kb(void) {
	FILE *f = fopen("/proc/self/smaps_rollup", "r");
	char line[256];
	long long kb = -1;
	while (f && fgets(line, sizeof line, f))
		if (strncmp(line, "Pss:", 4) == 0) kb = atoll(line + 4);
	if (f) fclose(f);
	return kb;
}

int main(int argc, char **argv) {
	stamp("main");
	const char *mode = argc > 1 ? argv[1] : "parallel";
	atomic_store(&want_integrated, argc > 2 && strcmp(argv[2], "integrated") == 0);
	XInitThreads();
	pthread_t thread;
	if (strcmp(mode, "parallel") == 0)
		pthread_create(&thread, NULL, gpu_thread, NULL);
	if (strcmp(mode, "gpu-only") == 0)
		start_device();
	Display *display = XOpenDisplay(NULL);
	window = XCreateSimpleWindow(display, DefaultRootWindow(display), 0, 0, WIDTH, HEIGHT, 0, 0, 0);
	XStoreName(display, window, "Open Paint Studio GPU spike");
	XSelectInput(display, window, ExposureMask | StructureNotifyMask);
	XMapWindow(display, window);
	for (;;) { XEvent e; XNextEvent(display, &e); if (e.type == MapNotify) break; }
	atomic_store(&window_ready, 1);
	if (strcmp(mode, "gpu-only") == 0) {
		start_presenting(display);
	} else {
		// The CPU frame: the editor's background with its title bar, put as
		// an XImage (the native edition uses MIT-SHM for the same).
		uint32_t *pixels = malloc((size_t)WIDTH * HEIGHT * 4);
		for (int y = 0; y < HEIGHT; y++)
			for (int x = 0; x < WIDTH; x++)
				pixels[y * WIDTH + x] = y < 42 ? 0x36363e : 0xfafaf9;
		XImage *image = XCreateImage(display, DefaultVisual(display, DefaultScreen(display)), 24, ZPixmap, 0, (char *)pixels, WIDTH, HEIGHT, 32, 0);
		XPutImage(display, window, DefaultGC(display, DefaultScreen(display)), image, 0, 0, 0, 0, WIDTH, HEIGHT);
		XSync(display, False);
		stamp("cpu-frame");
		printf("pss-cpu %lld\n", pss_kb());
		if (strcmp(mode, "after") == 0)
			pthread_create(&thread, NULL, gpu_thread, NULL);
		// The main thread stays responsive: it keeps handling events and
		// would keep drawing; the longest gap between its turns is reported.
		long long last = now_us(), longest = 0;
		while (!atomic_load(&gpu_ready)) {
			while (XPending(display)) { XEvent e; XNextEvent(display, &e); }
			long long t = now_us();
			if (t - last > longest) longest = t - last;
			last = t;
			struct timespec pause = {0, 1000000};
			nanosleep(&pause, NULL);
		}
		pthread_join(thread, NULL);
		printf("main-longest-gap-us %lld\n", longest);
	}
	printf("pss-gpu %lld\n", pss_kb());
	fflush(stdout);
	struct timespec hold = {0, 300000000};
	nanosleep(&hold, NULL);
	return 0;
}
