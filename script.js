// import { mat4 } from './gl-matrix.js';

// Get a GL context 
let gl = null;
let glCanvas = null;

/* ------------------------------------------------------------------------------------ */
// Make our constants
let CENTERED_TEXTURED_SQUARE_BUFFER = new Float32Array([
  -0.5, 0.5, 0.0, 0.0,
  -0.5, -0.5,  0.0, 1.0,
  0.5, -0.5, 1.0, 1.0,
  0.5, 0.5, 1.0, 0.0,
]);


/* ------------------------------------------------------------------------------------ */
// Make our classes 


// Manages a texture
class Texture {
	constructor(url) {
		self.tex = Texture.loadTexture(gl, url);
	}
	
	static loadTexture(gl, url) {
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);

		// Because images have to be download over the internet
		// they might take a moment until they are ready.
		// Until then put a single pixel in the texture so we can
		// use it immediately. When the image has finished downloading
		// we'll update the texture with the contents of the image.
		const level = 0;
		const internalFormat = gl.RGBA;
		const width = 1;
		const height = 1;
		const border = 0;
		const srcFormat = gl.RGBA;
		const srcType = gl.UNSIGNED_BYTE;
		const pixel = new Uint8Array([0, 0, 255, 255]);  // opaque blue
		gl.texImage2D(	gl.TEXTURE_2D, level, internalFormat,
						width, height, border, srcFormat, srcType,
						pixel);

		const image = new Image();
		image.onload = function() {
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texImage2D(	gl.TEXTURE_2D, level, internalFormat,
							srcFormat, srcType, image);

			// WebGL1 has different requirements for power of 2 images
			// vs non power of 2 images so check if the image is a
			// power of 2 in both dimensions.
			function isPowerOf2(value) {
			  return (value & (value - 1)) == 0;
			}
			
			if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
				// Yes, it's a power of 2. Generate mips.
				gl.generateMipmap(gl.TEXTURE_2D);
			} else {
				// No, it's not a power of 2. Turn off mips and set
				// wrapping to clamp to edge
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			}
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		};
		
		// Fetch it - the onload handles the rest
		image.crossOrigin = "anonymous";
		image.src = url;

		return texture;
	}

	bind(unit) {
		// Target the unit
		gl.activeTexture([
			gl.TEXTURE0,
			gl.TEXTURE1,
			gl.TEXTURE2,
			gl.TEXTURE3,
			gl.TEXTURE4,
			gl.TEXTURE5,
			gl.TEXTURE6,
			gl.TEXTURE7
		][unit]);
		
		// Bind it
		gl.bindTexture(gl.TEXTURE_2D, self.tex);
	}

}

// Represents a vertex attribute
class VertexAttribute {
	constructor(gl_attr, type, item_count, item_size, normalize) {
		this.attribute = gl_attr; // The attribute this corresponds to
		this.type = type; // The gl type (E.g. GL_FLOAT) that make up this attribute. Vec2 is floats, for instance.
		this.item_size = item_size; // The size(in bytes) of each item 
		this.item_count = item_count; // The number of items. vec3 -> 3, mat4 -> 16, etc.
		this.normalize = normalize; // Whether to normalize floats on this object.
	}
	
	byte_length() {
		return this.item_count * this.item_size;
	}
}

// Represents a list of vertices and a specific configuration for modifying them  
class AttributedVertexBuffer { 
	constructor(vertex_buffer, attributes) {
		// Save our obvious attributes
		this.vertex_buffer = gl.createBuffer();
		this.attributes = attributes;
		
		// Buffer the data.
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertex_buffer, gl.STATIC_DRAW);
		
		// Compute the total stride and items per vertex 
		let total_stride = 0;
		let items_per_vertex = 0;
		attributes.forEach(function(a) {
			total_stride += a.byte_length();
			items_per_vertex += a.item_count;
		});
		this.total_stride = total_stride;
		this.items_per_vertex = items_per_vertex;
		
		// How many vertices do we have? easy!
		this.vertex_count = vertex_buffer.length / items_per_vertex;
	}
	
	// Calling this functions configures the attributes as specified in this model.
	apply_attributes() {
		let stride = this.total_stride;
		let current_offset = 0;
		this.attributes.forEach(function(a) {
			// Get the size
			let size = a.byte_length();
			gl.vertexAttribPointer(a.attribute, a.item_count, a.type, a.normalize, stride, current_offset);
			gl.enableVertexAttribArray(a.attribute);
			
			// Update our stride
			current_offset += size;
		});
		
		// TODO: Disable all other attributes
	}
	
	// Draws the buffer. Note: does nothing to the matrices or uniforms. Just makes a draw call really.
	draw() {
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, this.vertex_count);
	}
}

// Represents a sprite
class AnimatedSprite {
	constructor(vertex_buff, texture, num_frames, x, y, scale, time_per_frame) {
		// Allocate our thingies
		this.model_matrix = glMatrix.mat4.create();
		this.translation_vec = glMatrix.vec3.create();
		this.scale_vec = glMatrix.vec3.create();
		this.translation_vec.z = 0.0;
		this.scale_vec.z = 0.0;
		
		// Initialize our matrix/vertices with provided data
		this.update_model(x, y, scale);
		
		// Rendering stuff
		this.vertex_buff = vertex_buff;
		this.texture = texture;
		
		// Static frame info
		this.num_frames = num_frames;
		this.frame_width = 1.0 / num_frames;
		this.time_per_frame = time_per_frame;
		
		// Dynamic frame info
		this.curr_frame = 0;
		this.curr_frame_time = 0.0; // Time we've been
		this.frame_vec = glMatrix.vec2.create();
		if(!time_per_frame) {
			console.log("Warning: shit's fucked");
			let fucked = 1 / 0;
		}
	}
	
	update_model(x, y, scale) {
		// Update our vectors
		this.translation_vec[0] = x;
		this.translation_vec[1] = y;
		this.scale_vec[0] = scale;
		this.scale_vec[1] = scale;
		
		// Update the matrix
		let translation_vec = glMatrix.vec3.fromValues(x, y, 0.0);
		let scale_vec = glMatrix.vec3.fromValues(scale, scale, 1.0);
		
		// Send it down the pipe
		glMatrix.mat4.fromTranslation(this.model_matrix, translation_vec);
		glMatrix.mat4.scale(this.model_matrix, this.model_matrix, scale_vec);
	}	
	
	draw() {
		// Set our texture(s) to be the one drawn
		this.texture.bind(diffuseUnit);
		
		// Tell where to draw
		gl.uniformMatrix4fv(uModelMatrix, false, this.model_matrix);
		
		// Set the frame offset
		let offset = this.frame_width * this.curr_frame;
		gl.uniform2f(uFrameInfo, offset, this.frame_width);
		
		// Draw
		// this.vertex_buff.apply_attributes();
		this.vertex_buff.draw();
	}
	
	// Tells this gif thing that the provided number of seconds have passed
	shift_time(time_in_seconds) {
		this.curr_frame_time += time_in_seconds;

		// Consume seconds to scroll frames
		while(this.curr_frame_time > this.time_per_frame) {
			this.curr_frame_time -= this.time_per_frame;
			this.curr_frame += 1;
		}
		
		// Wrap frames
		while(this.curr_frame >= this.num_frames) {
			this.curr_frame -= this.num_frames;
		}
	}
}



/* ------------------------------------------------------------------------------------ */
// Make our runtime vars

// Vertex information
let squareVertexBuffer;

// Uniforms
let uModelMatrix;
let uProjectionMatrix;
let uFrameInfo;
let uTextureSamplerDiffuse;

// Global Matrices 
let mProjectionMatrix;

// Texture unit indexes
let diffuseUnit = 0;

// Vertex attributes
let aVertexPosition;
let aTexturePosition;

// Animation timing
let previous_time = 0.0;

// Textures
let birdTex;

// Our things to draw
let sprites;

// Interactivity
let aspectRatio;
let mousePosition = glMatrix.vec3.create();


// Enable load
window.addEventListener("load", startup, false);

// Load this on startup. Setup birds, etc.
function startup() {
	// Find the canvas
	glCanvas = document.getElementById("glcanvas");
	gl = glCanvas.getContext("webgl");
	
	// Initialize global matrices
	mProjectionMatrix = glMatrix.mat4.create();

	// Indicate the names of our shaders
	const shaderSet = [
		{
			type: gl.VERTEX_SHADER,
			id: "vertex-shader"
		},
		{
			type: gl.FRAGMENT_SHADER,
			id: "fragment-shader"
		}
	];

	// Build our shader
	shaderProgram = buildShaderProgram(shaderSet);

	// Use the shader
	gl.useProgram(shaderProgram);

	// Find our uniforms
	uModelMatrix = gl.getUniformLocation(shaderProgram, "uModelMatrix");
	uProjectionMatrix = gl.getUniformLocation(shaderProgram, "uProjectionMatrix");
	uFrameInfo = gl.getUniformLocation(shaderProgram, "uFrameInfo");
	uTextureSamplerDiffuse = gl.getUniformLocation(shaderProgram, "uTextureSamplerDiffuse");

	// Find and configure our vertex attributes
	aVertexPosition = gl.getAttribLocation(shaderProgram, "aVertexPosition");
	let pos_attr = new VertexAttribute(aVertexPosition, gl.FLOAT, 2, 4, false);

	aTexturePosition = gl.getAttribLocation(shaderProgram, "aTexturePosition");
	let tex_attr = new VertexAttribute(aTexturePosition, gl.FLOAT, 2, 4, true); // Only difference: don't normalize

	// Make our buffer
	squareVertexBuffer = new AttributedVertexBuffer(CENTERED_TEXTURED_SQUARE_BUFFER, [pos_attr, tex_attr])

	// Load our textures
	birdTex = new Texture('birbsprites.png');
	
	// Set our texture uniforms to correspond to the appropriate units
	gl.uniform1i(uTextureSamplerDiffuse, diffuseUnit);
	
	// Neither of these will change. Bind both:
	squareVertexBuffer.apply_attributes();
	birdTex.bind(0);
	
	// Set the clear color to dull grey
	gl.clearColor(0.4, 0.4, 0.4, 1.0);
  
	// Add our sprites
	count = 32;
	width = 2.0 / count;
	sprites = [];
	for(row=0; row < count; row++) {
		for(col=0; col < count; col++) {
			let x = -1.0 + (width * 0.5) + (col * width);
			let y = -1.0 + (width * 0.5) + (row * width);
			
			let new_birb = new AnimatedSprite(squareVertexBuffer, birdTex, 20, x, y, width, 1.0/30);
			sprites.push(new_birb);
		}
	}
  
	// Run  
	animateScene();
}

// Helper to gather shader data 
function buildShaderProgram(shaderInfo) {
	let program = gl.createProgram();

	shaderInfo.forEach(function(desc) {
	let shader = compileShader(desc.id, desc.type);
		if (shader) {
		gl.attachShader(program, shader);
		}
	});

	gl.linkProgram(program)

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.log("Error linking shader program:");
		console.log(gl.getProgramInfoLog(program));
	}

	return program;
}

// Helper to compile shader 
function compileShader(id, type) {
	let code = document.getElementById(id).firstChild.nodeValue;
	let shader = gl.createShader(type);

	gl.shaderSource(shader, code);
	gl.compileShader(shader);

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.log(`Error compiling ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader:`);
		console.log(gl.getShaderInfoLog(shader));
	}
	return shader;
}

// Main loop
function animateScene() {
	// Setup default viewport. We run this every time because we need handle resizing
	gl.viewport(0, 0, glCanvas.width, glCanvas.height);
	updateProjection();

	// Clear color buffer
	gl.clear(gl.COLOR_BUFFER_BIT);

	// DRAW!
	sprites.forEach(function (sp) {
		sp.draw();
	});

	window.requestAnimationFrame(function(current_time) {
		let delta_time = (current_time - previous_time) / 1000.0; // Compute change in time in seconds

		// Update each
		sprites.forEach(function (sp) {
			// How far from mouse?
			let dist = glMatrix.vec2.distance(mousePosition, sp.translation_vec);
			dist = (0.7 - dist) * 3;
			
			if(dist > 0) {
				dist = Math.pow(dist, 0.5);							 
				sp.shift_time(delta_time * dist);	
			}
		});
		
		// Save previous time
		previous_time = current_time;

		// Do recursive work
		animateScene();
	});
}

// Helper that updates our projection matrix
function updateProjection() {
	// Compute our aspect ratio
	aspectRatio = glCanvas.width / glCanvas.height;
	glMatrix.mat4.ortho(mProjectionMatrix, -aspectRatio, aspectRatio, -1.0, 1.0, -1, 1);
	gl.uniformMatrix4fv(uProjectionMatrix, false, mProjectionMatrix);
}

// Helper that gives our mouse position in 
function updateMousePosition(evt) {
	if(glCanvas){
		let rect = glCanvas.getBoundingClientRect();
		let x = evt.clientX - rect.left;
		let y = evt.clientY - rect.top;

		// Get them proportional, in GL coords
		x = ((x / rect.width) - 0.5) * 2.0 * aspectRatio;
		y = ((y / rect.height) - 0.5) * -2.0;

		// Update the vec
		mousePosition[0] = x;
		mousePosition[1] = y;	
	}
}










